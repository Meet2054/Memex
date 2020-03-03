import { createSelector } from 'reselect'

import { RootState } from '../types'
import * as popup from '../selectors'
import * as blacklist from '../blacklist-button/selectors'

const bookmarkBtn = (state: RootState) => state.bookmarkBtn

export const isBookmarked = createSelector(
    bookmarkBtn,
    state => state.isBookmarked,
)

export const isDisabled = createSelector(
    popup.isLoggable,
    blacklist.isBlacklisted,
    isBookmarked,
    (isLoggable, isBlacklisted, isBm) =>
        !isLoggable || (isBlacklisted && !isBm),
)
