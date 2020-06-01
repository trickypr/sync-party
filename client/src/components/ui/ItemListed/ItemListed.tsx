import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { MediaItem, RootAppState } from '../../../types';

import ButtonIcon from '../../input/ButtonIcon/ButtonIcon';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPen, faTimes } from '@fortawesome/free-solid-svg-icons';
import ItemListedBody from '../ItemListedBody/ItemListedBody';
import ItemListedIcon from '../ItemListedIcon/ItemListedIcon';
import ItemListedPlayStatus from '../ItemListedPlayStatus/ItemListedPlayStatus';
import ItemListedNewIndicator from '../ItemListedNewIndicator/ItemListedNewIndicator';
import ItemListedDownloadLink from '../ItemListedDownloadLink/ItemListedDownloadLink';
import ItemListedClipboardButton from '../ItemListedClipboardButton/ItemListedClipboardButton';

type Props = {
    item: MediaItem;
    handleItemSave: Function;
    setPlayerFocused: Function;
    isCurrentlyPlayingItem?: boolean;
    alreadyPlayed?: boolean;
    isPlaying?: boolean;
    nameEditingAllowed: boolean;
    handleItemClick: Function;
    onRemoveButtonClick?: Function;
};

export default function ItemListed({
    item,
    handleItemSave,
    setPlayerFocused,
    isCurrentlyPlayingItem,
    alreadyPlayed,
    isPlaying,
    nameEditingAllowed,
    handleItemClick,
    onRemoveButtonClick
}: Props): JSX.Element {
    const [editMode, setEditMode] = useState(false);
    const [probablyEditedItem, setProbablyEditedItem] = useState(item);
    const [hovering, setHovering] = useState(false);

    const party = useSelector((state: RootAppState) => state.globalState.party);

    const { t } = useTranslation();

    React.useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);

        return (): void => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    });

    const handleKeyDown = (event: KeyboardEvent): void => {
        if (editMode) {
            if (event.code === 'Escape') {
                event.preventDefault();
                activateEditMode(false);
                setProbablyEditedItem(item);
            }
            if (event.code === 'Enter') {
                event.preventDefault();
                handleItemSave(probablyEditedItem);
                activateEditMode(false);
            }
        }
    };

    const activateEditMode = (activate: boolean): void => {
        if (activate) {
            setEditMode(true);
            setPlayerFocused(false);
        } else {
            setEditMode(false);
            setPlayerFocused(true);
        }
    };

    return (
        <div
            className="p-1 hover:bg-purple-900 cursor-pointer"
            key={item.id}
            title={
                nameEditingAllowed
                    ? t('mediaMenu.mediaItemClickAddTitle')
                    : t('mediaMenu.mediaItemClickPlayTitle')
            }
            onMouseOver={(): void => {
                setHovering(true);
            }}
            onMouseLeave={(): void => {
                setHovering(false);
            }}
        >
            <div className="flex flex-row justify-between">
                <div className="flex">
                    <ItemListedIcon
                        item={item}
                        editMode={editMode}
                        handleItemClick={handleItemClick}
                    ></ItemListedIcon>
                    <ItemListedBody
                        item={item}
                        probablyEditedItem={probablyEditedItem}
                        setProbablyEditedItem={(item: MediaItem): void =>
                            setProbablyEditedItem(item)
                        }
                        editMode={editMode}
                        handleItemClick={handleItemClick}
                        nameEditingAllowed={nameEditingAllowed}
                    ></ItemListedBody>
                </div>
                <div className="ml-2 mr-1 flex">
                    <ItemListedPlayStatus
                        isCurrentlyPlayingItem={isCurrentlyPlayingItem}
                        hovering={hovering}
                        isPlaying={isPlaying}
                    ></ItemListedPlayStatus>
                    {!isCurrentlyPlayingItem &&
                        alreadyPlayed === false &&
                        !hovering && (
                            <ItemListedNewIndicator></ItemListedNewIndicator>
                        )}
                    {!editMode && nameEditingAllowed ? (
                        <ButtonIcon
                            className={!hovering ? 'hidden' : ''}
                            color="text-gray-300 hover:text-gray-200"
                            onClick={(): void => activateEditMode(!editMode)}
                            title={t('mediaMenu.editButtonTitle')}
                            icon={
                                <FontAwesomeIcon
                                    icon={faPen}
                                    size="sm"
                                ></FontAwesomeIcon>
                            }
                        ></ButtonIcon>
                    ) : (
                        (editMode || !nameEditingAllowed) &&
                        hovering && (
                            <>
                                {probablyEditedItem.type === 'file' &&
                                    party && (
                                        <ItemListedDownloadLink
                                            hovering={hovering}
                                            partyId={party.id}
                                            itemId={probablyEditedItem.id}
                                        ></ItemListedDownloadLink>
                                    )}
                                {probablyEditedItem.type !== 'file' &&
                                    party && (
                                        <ItemListedClipboardButton
                                            itemUrl={probablyEditedItem.url}
                                            hovering={hovering}
                                        ></ItemListedClipboardButton>
                                    )}
                                {onRemoveButtonClick && (
                                    <ButtonIcon
                                        title={t(
                                            'mediaMenu.mediaItemRemoveTitle'
                                        )}
                                        onClick={(): void => {
                                            onRemoveButtonClick(item);
                                            setEditMode(false);
                                        }}
                                        color="text-gray-200 hover:text-gray-100"
                                        icon={
                                            <FontAwesomeIcon
                                                icon={faTimes}
                                                size="sm"
                                            ></FontAwesomeIcon>
                                        }
                                    ></ButtonIcon>
                                )}
                            </>
                        )
                    )}
                </div>
            </div>
        </div>
    );
}