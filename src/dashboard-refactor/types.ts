import { UIEvent } from 'ui-logic-core'

import {
    RootState as SearchResultsState,
    Events as SearchResultEvents,
} from './search-results/types'
import {
    RootState as ListsSidebarState,
    Events as ListsSidebarEvents,
} from './lists-sidebar/types'
import { RemoteTagsInterface } from 'src/tags/background/types'
import { RemoteCollectionsInterface } from 'src/custom-lists/background/types'
import { SearchInterface } from 'src/search/background/types'
import { AnnotationInterface } from 'src/annotations/background/types'

export interface RootState {
    searchResults: SearchResultsState
    searchFilters: SearchFiltersState
    listsSidebar: ListsSidebarState
}

export type Events = UIEvent<
    SearchResultEvents &
        SearchFilterEvents &
        ListsSidebarEvents & {
            searchPages: null
            searchNotes: null
            example: null
        }
>

export interface DashboardDependencies {
    tagsBG: RemoteTagsInterface
    listsBG: RemoteCollectionsInterface
    searchBG: SearchInterface
    annotationsBG: AnnotationInterface<'caller'>
}

export interface DropReceivingState {
    isDraggedOver?: boolean
    triggerSuccessfulDropAnimation?: boolean
    onDragOver(id: number): void
    onDragLeave(id: number): void
    onDrop(id: number): void
}

export interface SearchResultTextPart {
    text: string
    match: boolean
}

export interface HoverState {
    onHoverEnter(id: number): void
    onHoverLeave(id: number): void
    isHovered: boolean
}

export interface SelectedState {
    onSelection(id: number): void
    isSelected: boolean
}

export type ListSource = 'local-lists' | 'followed-list'

// TODO: move this into the filter's dir once merged in
export interface SearchFiltersState {
    searchQuery: string
    isSearchBarFocused: boolean
    searchFiltersOpen: boolean
    isTagFilterActive: boolean
    isDateFilterActive: boolean
    isDomainFilterActive: boolean

    dateFromInput: string
    dateToInput: string
    dateFrom?: number
    dateTo?: number

    tagsIncluded: string[]
    tagsExcluded: string[]
    domainsIncluded: string[]
    domainsExcluded: string[]
}

export type SearchFilterEvents = UIEvent<{
    setSearchQuery: { query: string }
    setSearchBarFocus: { isFocused: boolean }

    setSearchFiltersOpen: { isOpen: boolean }
    setTagFilterActive: { isActive: boolean }
    setDateFilterActive: { isActive: boolean }
    setDomainFilterActive: { isActive: boolean }

    setDateFromInputValue: { value: string }
    setDateToInputValue: { value: string }
    setDateFrom: { value: number }
    setDateTo: { value: number }

    addIncludedTag: { tag: string }
    delIncludedTag: { tag: string }
    addExcludedTag: { tag: string }
    delExcludedTag: { tag: string }

    addIncludedDomain: { domain: string }
    delIncludedDomain: { domain: string }
    addExcludedDomain: { domain: string }
    delExcludedDomain: { domain: string }

    setTagsIncluded: { tags: string[] }
    setTagsExcluded: { tags: string[] }
    setDomainsIncluded: { domains: string[] }
    setDomainsExcluded: { domains: string[] }

    resetFilters: null
}>
