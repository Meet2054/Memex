import React, { PureComponent, useState } from 'react'
import styled from 'styled-components'
import Icon from '@worldbrain/memex-common/lib/common-ui/components/icon'
import { fonts } from '../../styles'
import Margin from 'src/dashboard-refactor/components/Margin'
import { TooltipBox } from '@worldbrain/memex-common/lib/common-ui/components/tooltip-box'
import * as icons from 'src/common-ui/components/design-library/icons'
import { PrimaryAction } from '@worldbrain/memex-common/lib/common-ui/components/PrimaryAction'
import MemexEditor from '@worldbrain/memex-common/lib/editor'
import Markdown from '@worldbrain/memex-common/lib/common-ui/components/markdown'
import { getKeyName } from '@worldbrain/memex-common/lib/utils/os-specific-key-names'
import QuickTutorial from '@worldbrain/memex-common/lib/editor/components/QuickTutorial'
import { getKeyboardShortcutsState } from 'src/in-page-ui/keyboard-shortcuts/content_script/detection'
import { PopoutBox } from '@worldbrain/memex-common/lib/common-ui/components/popout-box'
import { sizeConstants } from '../../constants'
import TextField from '@worldbrain/memex-common/lib/common-ui/components/text-field'
import { UnifiedList } from 'src/annotations/cache/types'
import { ListData } from 'src/dashboard-refactor/lists-sidebar/types'

export interface Props {
    listName: string
    remoteLink?: string
    localListId: number
    isOwnedList?: boolean
    isJoinedList?: boolean
    description: string | null
    saveDescription: (description: string) => void
    saveTitle: (title: string, listId: number) => void
    onAddContributorsClick?: React.MouseEventHandler
    listId?: number
    clearInbox?: () => void
    allLists: { [id: string]: UnifiedList } | { [id: string]: ListData }
}

interface State {
    description: string
    isEditingDescription: boolean
    showQuickTutorial: boolean
    spaceTitle: string
}

export default class ListDetails extends PureComponent<Props, State> {
    static MOD_KEY = getKeyName({ key: 'mod' })
    private formattingHelpBtn = React.createRef<HTMLDivElement>()

    state: State = {
        description: this.props.description ?? '',
        isEditingDescription: false,
        showQuickTutorial: false,
        spaceTitle: this.props.listName,
    }

    componentWillUpdate(nextProps: Props) {
        if (this.props.localListId !== nextProps.localListId) {
            this.setState({
                description: nextProps.description ?? '',
                isEditingDescription: false,
                showQuickTutorial: false,
                spaceTitle: nextProps.listName,
            })
        }
    }

    private finishEdit(args: { shouldSave?: boolean }) {
        if (args.shouldSave) {
            this.props.saveDescription(this.state.description)
            this.props.saveTitle(this.state.spaceTitle, this.props.listId)
        }
        this.setState({
            isEditingDescription: false,
            showQuickTutorial: false,
        })
    }

    private handleDescriptionInputKeyDown: React.KeyboardEventHandler = (e) => {
        if (e.key === 'Escape') {
            this.finishEdit({ shouldSave: false })
            return
        }

        if (navigator.platform === 'MacIntel') {
            if (e.key === 'Enter' && e.metaKey) {
                this.finishEdit({ shouldSave: true })
                return
            }
        } else {
            if (e.key === 'Enter' && e.ctrlKey) {
                this.finishEdit({ shouldSave: true })
                return
            }
        }
    }

    private renderDescription() {
        if (this.state.isEditingDescription) {
            return (
                <DescriptionEditorContainer>
                    <MemexEditor
                        markdownContent={this.state.description}
                        onKeyDown={this.handleDescriptionInputKeyDown}
                        placeholder="Write a description for this Space"
                        onContentUpdate={(description) =>
                            this.setState({ description })
                        }
                        spaceSuggestions={this.props.allLists}
                    />
                </DescriptionEditorContainer>
            )
        }

        if (this.props.listId === 20201015) {
            return (
                <SubtitleText>
                    {'Things you saved from your mobile devices'}
                </SubtitleText>
            )
        }

        if (this.props.listId === 20201014) {
            return (
                <SubtitleText>
                    {
                        'Everything you save, annotate or organise appears here so you have a chance to go through it again.'
                    }
                </SubtitleText>
            )
        }

        return <DescriptionText>{this.props.description}</DescriptionText>
    }

    private renderEditButton() {
        // If followed list, don't allow editing
        if (!this.props.isOwnedList && !this.props.isJoinedList) {
            return null
        }

        return (
            <TooltipBox placement="bottom" tooltipText={'Edit Space'}>
                <Icon
                    hoverOff={!this.props.isOwnedList}
                    onClick={() =>
                        this.props.isOwnedList &&
                        this.setState({ isEditingDescription: true })
                    }
                    padding={'5px'}
                    heightAndWidth="22px"
                    icon={'edit'}
                />
            </TooltipBox>
        )
    }

    render() {
        return (
            <>
                <TopBarContainer bottom="10px">
                    <Container
                        hasDescription={this.props.description?.length > 0}
                        center={!this.props.remoteLink}
                    >
                        {this.state.isEditingDescription ? (
                            <TitleContainer>
                                <TextField
                                    value={this.state.spaceTitle}
                                    onChange={(e) =>
                                        this.setState({
                                            spaceTitle: (e.target as HTMLInputElement)
                                                .value,
                                        })
                                    }
                                    autoFocus
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            this.finishEdit({
                                                shouldSave:
                                                    this.props.description !==
                                                        this.state
                                                            .description ||
                                                    this.props.listName !==
                                                        this.state.spaceTitle,
                                            })
                                        } else if (e.key === 'Escape') {
                                            this.finishEdit({
                                                shouldSave: false,
                                            })
                                            return
                                        }
                                    }}
                                />
                                <BtnContainerStyled>
                                    <TooltipBox
                                        tooltipText="esc"
                                        placement="bottom"
                                    >
                                        <Icon
                                            heightAndWidth="22px"
                                            icon={icons.removeX}
                                            color={'white'}
                                            onClick={() =>
                                                this.setState({
                                                    isEditingDescription: false,
                                                })
                                            }
                                        />
                                    </TooltipBox>
                                    <TooltipBox
                                        tooltipText={`${ListDetails.MOD_KEY} + Enter`}
                                        placement="bottom"
                                    >
                                        <Icon
                                            heightAndWidth="22px"
                                            icon={icons.check}
                                            color={'prime1'}
                                            onClick={() =>
                                                this.finishEdit({
                                                    shouldSave:
                                                        this.props
                                                            .description !==
                                                            this.state
                                                                .description ||
                                                        this.props.listName !==
                                                            this.state
                                                                .spaceTitle,
                                                })
                                            }
                                        />
                                    </TooltipBox>
                                </BtnContainerStyled>
                            </TitleContainer>
                        ) : (
                            <TitleContainer>
                                <DetailsContainer>
                                    <SectionTitle>
                                        {this.props.listName}
                                        {this.props.listId === 20201015 &&
                                            'Saved on Mobile'}
                                        {this.props.listId === 20201014 &&
                                            'Inbox'}
                                    </SectionTitle>
                                    {/* <TitleEditContainer>
                                    {this.renderEditButton()}
                                </TitleEditContainer> */}
                                </DetailsContainer>
                                <BtnsContainer>
                                    {this.props.listId === 20201014 ? (
                                        <TooltipBox
                                            tooltipText={
                                                <TooltipTextContent>
                                                    <strong>Tip:</strong> Remove
                                                    individual pages with the
                                                    <br />{' '}
                                                    <Icon
                                                        filePath="removeX"
                                                        hoverOff
                                                        heightAndWidth="16px"
                                                    />{' '}
                                                    icon when hovering page
                                                    cards
                                                </TooltipTextContent>
                                            }
                                            placement="bottom-end"
                                        >
                                            <PrimaryAction
                                                label={'Clear Inbox'}
                                                onClick={() =>
                                                    this.props.clearInbox()
                                                }
                                                type={'forth'}
                                                size={'medium'}
                                                icon={'removeX'}
                                            />
                                        </TooltipBox>
                                    ) : undefined}
                                    {this.props.listId !== 20201014 &&
                                    this.props.listId !== 20201015 ? (
                                        <SpaceButtonRow>
                                            {this.props.isOwnedList ? (
                                                <>
                                                    <ActionButtons>
                                                        {this.renderEditButton()}
                                                        <TooltipBox
                                                            placement={'bottom'}
                                                            tooltipText="Open in web view"
                                                        >
                                                            <Icon
                                                                height="22px"
                                                                padding={'5px'}
                                                                filePath={
                                                                    icons.goTo
                                                                }
                                                                onClick={() =>
                                                                    window.open(
                                                                        this
                                                                            .props
                                                                            .remoteLink,
                                                                    )
                                                                }
                                                            />
                                                        </TooltipBox>
                                                    </ActionButtons>
                                                    {this.props.remoteLink ? (
                                                        <PrimaryAction
                                                            onClick={
                                                                this.props
                                                                    .onAddContributorsClick
                                                            }
                                                            size={'medium'}
                                                            type={'primary'}
                                                            label={
                                                                'Share Space'
                                                            }
                                                            icon={'invite'}
                                                        />
                                                    ) : (
                                                        <TooltipBox
                                                            tooltipText="Invite people to this Space"
                                                            placement="bottom"
                                                        >
                                                            <PrimaryAction
                                                                onClick={
                                                                    this.props
                                                                        .onAddContributorsClick
                                                                }
                                                                size={'medium'}
                                                                type={'primary'}
                                                                label={
                                                                    'Share Space'
                                                                }
                                                                icon={'invite'}
                                                            />
                                                        </TooltipBox>
                                                    )}
                                                </>
                                            ) : (
                                                <PrimaryAction
                                                    onClick={() =>
                                                        window.open(
                                                            this.props
                                                                .remoteLink,
                                                        )
                                                    }
                                                    size={'medium'}
                                                    type={'primary'}
                                                    label={'Open in web view'}
                                                    icon={'goTo'}
                                                />
                                            )}
                                        </SpaceButtonRow>
                                    ) : undefined}
                                </BtnsContainer>
                            </TitleContainer>
                        )}
                        {this.props.isOwnedList &&
                            !this.props.description?.length &&
                            !this.state.isEditingDescription && (
                                <>
                                    <EditDescriptionButton
                                        onClick={() =>
                                            this.setState({
                                                isEditingDescription: true,
                                            })
                                        }
                                    >
                                        + Add Space description
                                    </EditDescriptionButton>
                                </>
                            )}
                    </Container>
                    <DescriptionContainer>
                        {this.renderDescription()}
                        {/* {!this.state.isEditingDescription && (
                            <DescriptionEditContainer>
                                {this.renderEditButton()}
                            </DescriptionEditContainer>
                        )} */}
                    </DescriptionContainer>
                    {this.state.showQuickTutorial && (
                        <PopoutBox
                            targetElementRef={this.formattingHelpBtn.current}
                            placement={'bottom-start'}
                            closeComponent={() =>
                                this.setState({ showQuickTutorial: false })
                            }
                            offsetX={5}
                        >
                            <QuickTutorial
                                markdownHelpOnTop={true}
                                getKeyboardShortcutsState={
                                    getKeyboardShortcutsState
                                }
                            />
                        </PopoutBox>
                    )}
                </TopBarContainer>
            </>
        )
    }
}

const SubtitleText = styled.div`
    color: ${(props) => props.theme.colors.greyScale5};
    display: flex;
    text-align: left;
    font-size: 14px;
`

const TooltipTextContent = styled.div`
    display: block;
    line-height: 23px;

    > div {
        display: inline-block;
        vertical-align: middle;
    }
`

const SpaceButtonRow = styled.div`
    display: flex;
    grid-gap: 20px;
    align-items: center;
`
const ActionButtons = styled.div`
    display: flex;
    grid-gap: 10px;
    align-items: center;
`

const TitleContainer = styled.div`
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    grid-gap: 10px;
`

const EditDescriptionButton = styled.div`
    color: ${(props) => props.theme.colors.prime2};
    font-size: 14px;
    border: none;
    background: none;
    padding: 8px 10px 8px 0px;
    cursor: pointer;
`

const DescriptionEditorContainer = styled.div`
    width: 100%;
    border-radius: 6px;
    margin-top: 5px;

    & > div:first-child {
        & > div {
            margin: 0px 0px 5px 0px;
        }
    }
`

const SaveActionBar = styled.div`
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    margin-top: 5px;
`

const BtnContainerStyled = styled.div`
    display: flex;
    flex-direction: row;
    justify-content: flex-end;
    align-items: center;
    grid-gap: 10px;
`

const TopBarContainer = styled(Margin)`
    z-index: 3010;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    border-radius: 10px;
    padding: 20px 0 5px 0;
    max-width: ${sizeConstants.searchResults.widthPx}px;
`

const MarkdownButtonContainer = styled.div`
    display: flex;
    font-size: 12px;
    color: ${(props) => props.theme.colors.greyScale5};
    align-items: center;
    cursor: pointer;
`

const SectionTitle = styled.div`
    color: ${(props) => props.theme.colors.white};
    font-size: 24px;
    font-weight: bold;
`

const TitleEditContainer = styled.div`
    display: none;
    margin-left: 5px;
`
const DescriptionEditContainer = styled.div`
    display: none;
`

const Container = styled.div<{ hasDescription: boolean; center: boolean }>`
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: flex-start;
    width: 100%;
    z-index: 1002;

    & a {
        text-decoration: none;
        font-weight: 600;
    }
`

const DetailsContainer = styled.div`
    display: flex;
    flex-direction: row;
    grid-gap: 5px;
    width: 100%;

    &:hover ${TitleEditContainer} {
        display: flex;
    }
`

const ShareCollectionBtn = styled.div`
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    grid-gap: 5px;
`

const ShareCollectionBtnLabel = styled.div`
    font-size: 14px;
`

const BtnsContainer = styled.div`
    display: flex;
    align-items: center;
    z-index: 100;
    align-self: flex-start;
    grid-gap: 5px;
`

const DescriptionContainer = styled.div`
    width: 100%;
    margin-top: 10px;
    display: flex;
    justify-content: flex-start;

    &:hover ${DescriptionEditContainer} {
        display: flex;
        justify-self: flex-start;
        align-self: flex-start;
        position: absolute;
    }
`

const DescriptionText = styled(Markdown)`
    color: ${(props) => props.theme.colors.greyScale5};
`
