import type {
    RemoteFunctionRole,
    RemotePositionalFunction,
} from 'src/util/webextensionRPC'
import type { BackupTimes } from '../types'

export interface BackupInterface<Role extends RemoteFunctionRole> {
    isAutomaticBackupEnabled: RemotePositionalFunction<Role, [], boolean>
    isAutomaticBackupAllowed: RemotePositionalFunction<Role, [], boolean>
    disableAutomaticBackup: RemotePositionalFunction<Role, [], void>
    enableAutomaticBackup: RemotePositionalFunction<Role, [], void>
    disableRecordingChanges: RemotePositionalFunction<Role, [], void>
    getBackupTimes: RemotePositionalFunction<Role, [], BackupTimes>
    startBackup: RemotePositionalFunction<Role, [], void>
}

export interface LocalBackupSettings {
    saveBlobs: any
    lastBackup: Date
    accessTokenExpiry: Date
    lastBackupFinished: Date
    lastProblemNotifShown: Date

    accessToken: string
    refreshToken: string
    backendLocation: string

    isOnboarding: boolean
    runningBackup: boolean
    runningRestore: boolean
    progressSuccess: boolean
    hasInitialBackup: boolean
    driveAuthenticated: boolean
    progressSuccessful: boolean
    backupIsAuthenticating: boolean
    restoreIsAuthenticating: boolean
    automaticBackupsEnabled: boolean
}
