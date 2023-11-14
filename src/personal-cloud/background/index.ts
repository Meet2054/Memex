import type Dexie from 'dexie'
import type StorageManager from '@worldbrain/storex'
import { getObjectByPk, getObjectWhereByPk } from '@worldbrain/storex/lib/utils'
import type { StorageOperationEvent } from '@worldbrain/storex-middleware-change-watcher/lib/types'
import {
    getCurrentSchemaVersion,
    isTermsField,
} from '@worldbrain/memex-common/lib/storage/utils'
import { AsyncMutex } from '@worldbrain/memex-common/lib/utils/async-mutex'
import ActionQueue from '@worldbrain/memex-common/lib/action-queue'
import {
    PersonalCloudBackend,
    PersonalCloudUpdateType,
    PersonalCloudUpdateBatch,
    PersonalCloudClientInstructionType,
    PersonalCloudClientStorageType,
    PersonalCloudUpdate,
    PersonalCloudOverwriteUpdate,
    PersonalCloudDeviceId,
    PersonalCloudMediaBackend,
} from '@worldbrain/memex-common/lib/personal-cloud/backend/types'
import { preprocessPulledObject } from '@worldbrain/memex-common/lib/personal-cloud/utils'
import {
    PersonalCloudAction,
    PersonalCloudActionType,
    LocalPersonalCloudSettings,
    PersonalCloudRemoteInterface,
    PersonalCloudStats,
} from './types'
import {
    PERSONAL_CLOUD_ACTION_RETRY_INTERVAL,
    PASSIVE_DATA_CUTOFF_DATE,
} from './constants'
import type {
    ActionExecutor,
    ActionPreprocessor,
} from '@worldbrain/memex-common/lib/action-queue/types'
import { STORAGE_VERSIONS } from 'src/storage/constants'
import { wipePassiveData } from 'src/personal-cloud/storage/passive-data-wipe'
import { prepareDataMigration } from 'src/personal-cloud/storage/migration-preparation'
import type { SettingStore } from 'src/util/settings'
import { blobToString } from 'src/util/blob-utils'
import * as Raven from 'src/util/raven'
import type { RemoteEventEmitter } from '../../util/webextensionRPC'
import type { LocalExtensionSettings } from 'src/background-script/types'
import type { SyncSettingsStore } from 'src/sync-settings/util'
import type { Runtime } from 'webextension-polyfill'
import type { JobScheduler } from 'src/job-scheduler/background/job-scheduler'
import type { AuthChange } from '@worldbrain/memex-common/lib/authentication/types'

export interface PersonalCloudBackgroundOptions {
    backend: PersonalCloudBackend
    mediaBackend: PersonalCloudMediaBackend
    runtimeAPI: Runtime.Static
    extensionVersion: string
    storageManager: StorageManager
    syncSettingsStore: SyncSettingsStore<'dashboard'>
    persistentStorageManager: StorageManager
    remoteEventEmitter: RemoteEventEmitter<'personalCloud'>
    getUserId(): Promise<string | number | null>
    authChanges(): AsyncIterableIterator<AuthChange>
    settingStore: SettingStore<LocalPersonalCloudSettings>
    localExtSettingStore: SettingStore<LocalExtensionSettings>
    writeIncomingData(params: {
        storageType: PersonalCloudClientStorageType
        collection: string
        where?: { [key: string]: any }
        updates: { [key: string]: any }
    }): Promise<void>
    serverStorageManager: StorageManager
    jobScheduler: JobScheduler
}

export class PersonalCloudBackground {
    currentSchemaVersion?: Date
    actionQueue: ActionQueue<PersonalCloudAction>
    pendingActionsExecuting: Promise<void>
    authChangesObserved: Promise<void>
    changesIntegrating: Promise<void>
    pushMutex = new AsyncMutex()
    pullMutex = new AsyncMutex()
    deviceId: PersonalCloudDeviceId | null = null
    reportExecutingAction?: (action: PersonalCloudAction) => void
    remoteFunctions: PersonalCloudRemoteInterface
    emitEvents = true
    debug = process.env.NODE_ENV === 'development'

    strictErrorReporting = false
    _integrationError?: Error

    stats: PersonalCloudStats = {
        pendingDownloads: 0,
        pendingUploads: 0,
    }

    constructor(public options: PersonalCloudBackgroundOptions) {
        this.actionQueue = new ActionQueue({
            storageManager: options.storageManager,
            collectionName: 'personalCloudAction',
            versions: { initial: STORAGE_VERSIONS[25].version },
            retryIntervalInMs: PERSONAL_CLOUD_ACTION_RETRY_INTERVAL,
            executeAction: this.processPersonalCloudAction,
            preprocessAction: this.preprocessAction,
            onSetupError: (err) => Raven.captureException(err),
            setTimeout: (job, timeout) => {
                options.jobScheduler.scheduleJobOnce({
                    name: 'personal-cloud-action-queue-retry',
                    when: Date.now() + timeout,
                    job,
                })
                return -1
            },
        })

        this.setupEventListeners()

        this.remoteFunctions = {
            runDataMigration: this.waitForSync,
            isCloudSyncEnabled: this.isCloudSyncEnabled,
            runDataMigrationPreparation: this.prepareDataMigration,
            enableCloudSyncForNewInstall: this.enableSyncForNewInstall,
            isPassiveDataRemovalNeeded: this.isPassiveDataRemovalNeeded,
            runPassiveDataClean: () =>
                wipePassiveData({ db: this.dexie, visitLimit: 20 }),
        }
    }

    private get dexie(): Dexie {
        return this.options.storageManager.backend['dexie']
    }

    private setupEventListeners() {
        this.options.runtimeAPI.onStartup.addListener(async () => {
            await this.startSync()
        })
        this.actionQueue.events.on('statsChanged', async (stats) => {
            this._modifyStats({
                pendingUploads: stats.pendingActionCount,
            })
            await this.options.settingStore.set('lastSyncUpload', Date.now())
        })
        // TODO: re-implement pending download count
        this.options.backend.events.on('incomingChangesPending', (event) => {
            this._modifyStats({
                pendingDownloads:
                    this.stats.pendingDownloads + event.changeCountDelta,
            })
        })
        this.options.backend.events.on('incomingChangesProcessed', (event) => {
            this._modifyStats({
                pendingDownloads: this.stats.pendingDownloads - event.count,
            })
        })
    }

    private prepareDataMigration = async () => {
        const db = this.dexie

        await prepareDataMigration({
            db,
            chunkSize: 350,
            resetQueue: async () => {
                await db.table('personalCloudAction').clear()
                await this.actionQueue.resetPendingActionCount()
                this._modifyStats({ pendingDownloads: 0, pendingUploads: 0 })
            },
            queueObjs: (actionData) =>
                this.actionQueue.scheduleManyActions(
                    actionData.objs.map((object) => ({
                        type: PersonalCloudActionType.PushObject,
                        updates: [
                            {
                                type: PersonalCloudUpdateType.Overwrite,
                                schemaVersion: this.currentSchemaVersion!,
                                extVersion: this.options.extensionVersion,
                                deviceId: this.deviceId,
                                collection: actionData.collection,
                                object: this.preprocessObjectForPush({
                                    collection: actionData.collection,
                                    object,
                                }),
                            },
                        ],
                    })),
                    { queueInteraction: 'queue-and-return' },
                ),
        })

        await this.enableSync()
        await this.startSync()
    }

    private isCloudSyncEnabled = () => this.options.settingStore.get('isSetUp')

    triggerSyncContinuation() {
        this.options.backend.triggerSyncContinuation()
    }

    async setup() {
        this.deviceId = await this.options.settingStore.get('deviceId')

        this.currentSchemaVersion = getCurrentSchemaVersion(
            this.options.storageManager,
        )

        await this.actionQueue.setup({ paused: true })
        this._modifyStats({
            pendingUploads: this.actionQueue.pendingActionCount,
        })

        await this.startSync()
    }

    private async observeAuthChanges() {
        for await (const { nextUser, deviceId } of this.options.authChanges()) {
            this.deviceId = deviceId

            if (nextUser != null) {
                this.actionQueue.unpause()
                await this.startSync()
            } else {
                this.actionQueue.pause()
                this._modifyStats({
                    pendingDownloads: 0,
                    pendingUploads: 0,
                })
            }
        }
    }

    async enableSync() {
        await this.options.settingStore.set('isSetUp', true)
    }

    enableSyncForNewInstall = async (now = Date.now()) => {
        await this.enableSync()
        await this.startSync()
    }

    async startSync() {
        const userId = await this.options.getUserId()
        if (userId != null) {
            this.actionQueue.unpause()
        } else {
            this.actionQueue.pause()
        }

        if (!this.pendingActionsExecuting) {
            this.pendingActionsExecuting = this.actionQueue.executePendingActions()
        }
        // These will never return, so don't await for it
        if (!this.authChangesObserved) {
            this.authChangesObserved = this.observeAuthChanges()
        }
        if (!this.changesIntegrating) {
            this.changesIntegrating = this.integrateContinuously()
        }
    }

    private _modifyStats(updates: Partial<PersonalCloudStats>) {
        this.stats = { ...this.stats, ...updates }
        this._debugLog('Updated stats', this.stats)
        if (this.emitEvents) {
            try {
                this.options.remoteEventEmitter.emit('cloudStatsUpdated', {
                    stats: this.stats,
                })
            } catch (err) {
                console.error('Error while emitting updated stats:', err)
            }
        }
    }

    async integrateAllUpdates(): Promise<void> {
        const { backend, settingStore } = this.options
        const { batch, lastSeen } = await backend.bulkDownloadUpdates()
        await this.integrateUpdates(batch)
        await settingStore.set('lastSeen', lastSeen)
    }

    async integrateContinuously() {
        const { backend, settingStore } = this.options
        try {
            for await (const { batch, lastSeen } of backend.streamUpdates()) {
                try {
                    await this.integrateUpdates(batch)
                    await settingStore.set('lastSeen', lastSeen)
                } catch (err) {
                    if (this.strictErrorReporting) {
                        this._integrationError = err
                        throw err
                    } else {
                        console.error(
                            `Error integrating update from cloud`,
                            err,
                        )
                        Raven.captureException(err)
                    }
                }
            }
        } catch (err) {
            this._integrationError = err
            if (!this.strictErrorReporting) {
                console.error(err)
            }
        }
    }

    async integrateUpdates(updates: PersonalCloudUpdateBatch) {
        this.options.remoteEventEmitter.emit('downloadStarted')
        const { releaseMutex } = await this.pullMutex.lock()
        for (const update of updates) {
            await this.integrateUpdate(update)
        }
        releaseMutex()
        this.options.remoteEventEmitter.emit('downloadStopped')
    }

    async integrateUpdate(update: PersonalCloudUpdate) {
        this._debugLog('Processing update', update)

        const { collection } = update
        const storageManager =
            update.storage === 'persistent'
                ? this.options.persistentStorageManager
                : this.options.storageManager

        if (update.type === PersonalCloudUpdateType.Overwrite) {
            preprocessPulledObject({
                storageRegistry: storageManager.registry,
                collection,
                object: update.object,
            })
            if (update.media) {
                try {
                    await this.downloadMedia(update)
                } catch (err) {
                    const errorMsg = `Error while downloading media for update`
                    console.error(`${errorMsg}:`, err)
                    Raven.captureBreadcrumb({ update })
                    Raven.captureException(new Error(err))
                }
            }

            await this.options.writeIncomingData({
                storageType:
                    update.storage ?? PersonalCloudClientStorageType.Normal,
                collection: update.collection,
                updates: update.object,
                where: update.where,
            })
        } else if (update.type === PersonalCloudUpdateType.Delete) {
            await storageManager.backend.operation(
                'deleteObjects',
                update.collection,
                update.where,
            )
        }
    }

    async downloadMedia(
        update: Pick<PersonalCloudOverwriteUpdate, 'media' | 'object'>,
    ) {
        await Promise.all(
            Object.entries(update.media).map(
                async ([fieldName, { path, type }]) => {
                    let fieldValue:
                        | Blob
                        | string = await this.options.mediaBackend.downloadFromMedia(
                        { path },
                    )
                    if (type === 'text' || type === 'json') {
                        if (fieldValue instanceof Blob) {
                            fieldValue = await blobToString(fieldValue)
                        }
                    }
                    if (type === 'json') {
                        fieldValue = JSON.parse(fieldValue as string)
                    }

                    update.object[fieldName] = fieldValue
                },
            ),
        )
    }

    waitForSync = async () => {
        this._debugLog('waitforsync Start')
        await this.pushMutex.wait()
        this._debugLog('pushMutex done')
        await this.pullMutex.wait()
        this._debugLog('pullMutex done')
        await this.actionQueue.waitForSync()
        this._debugLog('actionQueue done')
        if (this.strictErrorReporting && this._integrationError) {
            throw this._integrationError
        }
        this._debugLog('waitforsyncdone')
    }

    async handlePostStorageChange(event: StorageOperationEvent<'post'>) {
        this._debugLog('Process storage change:', event)

        const { releaseMutex } = await this.pushMutex.lock()

        for (const change of event.info.changes) {
            const { collection } = change
            if (change.type === 'create') {
                const object = await getObjectByPk(
                    this.options.storageManager,
                    collection,
                    change.pk,
                )
                if (!object) {
                    // Here we assume the object is already deleted again before
                    // we got the change to look at it, so just ignore the create
                    continue
                }
                await this.actionQueue.scheduleAction(
                    {
                        type: PersonalCloudActionType.PushObject,
                        updates: [
                            {
                                type: PersonalCloudUpdateType.Overwrite,
                                schemaVersion: this.currentSchemaVersion!,
                                extVersion: this.options.extensionVersion,
                                deviceId: this.deviceId,
                                collection,
                                object: this.preprocessObjectForPush({
                                    collection,
                                    object,
                                }),
                            },
                        ],
                    },
                    { queueInteraction: 'queue-and-return' },
                )
            } else if (change.type === 'modify') {
                const objects = await Promise.all(
                    change.pks.map((pk) =>
                        getObjectByPk(
                            this.options.storageManager,
                            collection,
                            pk,
                        ),
                    ),
                )
                await this.actionQueue.scheduleAction(
                    {
                        type: PersonalCloudActionType.PushObject,
                        updates: objects
                            .filter((object) => !!object)
                            .map((object) => ({
                                type: PersonalCloudUpdateType.Overwrite,
                                schemaVersion: this.currentSchemaVersion!,
                                extVersion: this.options.extensionVersion,
                                deviceId: this.deviceId,
                                collection,
                                object,
                            })),
                    },
                    { queueInteraction: 'queue-and-return' },
                )
            } else if (change.type === 'delete') {
                const wheres = await Promise.all(
                    change.pks.map((pk) =>
                        getObjectWhereByPk(
                            this.options.storageManager.registry,
                            collection,
                            pk,
                        ),
                    ),
                )
                await this.actionQueue.scheduleAction(
                    {
                        type: PersonalCloudActionType.PushObject,
                        updates: wheres.map((where) => ({
                            type: PersonalCloudUpdateType.Delete,
                            schemaVersion: this.currentSchemaVersion!,
                            extVersion: this.options.extensionVersion,
                            deviceId: this.deviceId,
                            collection,
                            where,
                        })),
                    },
                    { queueInteraction: 'queue-and-return' },
                )
            }
        }

        releaseMutex()
    }

    preprocessObjectForPush({
        collection,
        object,
    }: {
        collection: string
        object: any
    }) {
        for (const field of Object.keys(object)) {
            if (isTermsField({ collection, field })) {
                delete object[field]
            }
        }
        if (collection === 'pages') {
            delete object.text
        }
        if (collection === 'favIcons') {
            delete object.favIcon
        }
        return object
    }

    processPersonalCloudAction: ActionExecutor<PersonalCloudAction> = async ({
        action,
    }) => {
        if (this.deviceId == null || (await this.options.getUserId()) == null) {
            this._debugLog(
                'Tried to execute action without deviceId, so pausing the action queue',
            )
            return { pauseAndRetry: true }
        }
        this._debugLog('Executing action', action)

        // For automated tests
        this.reportExecutingAction?.(action)

        if (action.type === PersonalCloudActionType.PushObject) {
            const {
                clientInstructions,
            } = await this.options.backend.pushUpdates(
                action.updates.map((update) => ({
                    ...update,
                    deviceId: update.deviceId ?? this.deviceId,
                })),
            )
            if (clientInstructions.length) {
                await this.actionQueue.scheduleAction(
                    {
                        type: PersonalCloudActionType.ExecuteClientInstructions,
                        clientInstructions,
                    },
                    { queueInteraction: 'skip-queue' },
                )
            }
        } else if (
            action.type === PersonalCloudActionType.ExecuteClientInstructions
        ) {
            const { clientInstructions } = action
            await Promise.all(
                clientInstructions.map(async (instruction) => {
                    if (
                        instruction.type ===
                        PersonalCloudClientInstructionType.UploadToStorage
                    ) {
                        const storageManager =
                            instruction.storage === 'persistent'
                                ? this.options.persistentStorageManager
                                : this.options.storageManager

                        if (
                            !storageManager.registry.collections[
                                instruction.collection
                            ]
                        ) {
                            const errorMsg = `Non-existing collection in clientInstruction:`
                            console.error(errorMsg, instruction)
                            Raven.captureBreadcrumb({
                                clientInstruction: instruction,
                            })
                            Raven.captureException(new Error(errorMsg))
                            return
                        }

                        let dbObject
                        try {
                            dbObject = await storageManager
                                .collection(instruction.collection)
                                .findObject(instruction.uploadWhere)
                        } catch (err) {
                            console.error(
                                `Could not fetch dbObject for instruction`,
                                instruction,
                                err,
                            )
                            Raven.captureBreadcrumb({
                                clientInstruction: instruction,
                            })
                            Raven.captureException(err)
                            return
                        }
                        if (!dbObject) {
                            this._debugLog(
                                'Could not find dbObject for clientInstruction:',
                                instruction,
                            )
                            return
                        }
                        let storageObject = dbObject[instruction.uploadField]
                        if (instruction.uploadAsJson) {
                            storageObject = new Blob(
                                [JSON.stringify(storageObject)],
                                {
                                    type:
                                        instruction.uploadContentType ??
                                        'application/json',
                                },
                            )
                        }
                        if (
                            !storageObject ||
                            (typeof storageObject !== 'string' &&
                                !(storageObject instanceof Blob))
                        ) {
                            const errorMsg = `Don't know how to store object for instruction`
                            console.error(errorMsg, instruction)
                            Raven.captureBreadcrumb({
                                clientInstruction: instruction,
                            })
                            Raven.captureException(new Error(errorMsg))
                            return
                        }
                        try {
                            await this.options.mediaBackend.uploadToMedia({
                                deviceId: this.deviceId,
                                mediaPath: instruction.uploadPath,
                                mediaObject: storageObject,
                                changeInfo: instruction.changeInfo,
                                contentType: instruction.uploadContentType,
                            })
                        } catch (e) {
                            console.error(
                                'Could not execute client instruction',
                                instruction,
                            )
                            console.error(e)
                            Raven.captureBreadcrumb({
                                clientInstruction: instruction,
                            })
                            Raven.captureException(e)
                        }
                    }
                }),
            )
        }
    }

    preprocessAction: ActionPreprocessor<PersonalCloudAction> = (action) => {
        this._debugLog('Scheduling action:', action)
        return { valid: true }
    }

    async getBlockStats(): Promise<{ usedBlocks: number }> {
        const userId = await this.options.getUserId()
        if (!userId) {
            throw new Error(`Cannot get block stats if not authenticated`)
        }

        const serverStorageManager = this.options.serverStorageManager
        const blockStats = await serverStorageManager.operation(
            'findObject',
            'personalBlockStats',
            {
                user: userId,
            },
        )
        if (!blockStats) {
            return { usedBlocks: 0 }
        }
        return blockStats.usedBlocks
    }

    _debugLog(...args: any[]) {
        if (this.debug) {
            console['log']('Personal Cloud -', ...args)
        }
    }

    private isPassiveDataRemovalNeeded: () => Promise<boolean> = async () => {
        const { localExtSettingStore } = this.options

        const installTime = await localExtSettingStore.get('installTimestamp')
        return installTime < PASSIVE_DATA_CUTOFF_DATE.getTime()
    }
}
