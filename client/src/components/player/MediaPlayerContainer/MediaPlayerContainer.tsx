import React, {
    useRef,
    useEffect,
    useReducer,
    useCallback,
    useState
} from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { setGlobalState } from '../../../actions/globalActions';
import {
    RootAppState,
    PlayerState,
    PlayerStateActionProperties,
    PlayerTimeoutState,
    PlayerTimeoutStateActionProperties,
    MediaItem,
    SyncStatusIncoming,
    SyncStatusOutgoing,
    SyncStatusReceiveMember,
    ClientPartyMember,
    PlayOrder,
    PlayWish,
    ReactPlayerState,
    MemberStatus
} from '../../../types';

import {
    useInterval,
    axiosConfig,
    handleKeyCommands,
    getSite,
    calculateSyncDelta
} from '../../../common/helpers';
import Axios from 'axios';
import screenfull, { Screenfull } from 'screenfull';

import ReactPlayer from 'react-player';
import TopBar from '../../ui/TopBar/TopBar';
import BottomBar from '../../ui/BottomBar/BottomBar';
import MediaMenu from '../../ui/MediaMenu/MediaMenu';
import MediaPlayerOverlay from '../MediaPlayerOverlay/MediaPlayerOverlay';
import ActionMessageContent from '../../display/ActionMessageContent/ActionMessageContent';

import {
    faPlay,
    faPause,
    faExchangeAlt,
    faLongArrowAltLeft,
    faLongArrowAltRight
} from '@fortawesome/free-solid-svg-icons';
import { faClock } from '@fortawesome/free-regular-svg-icons';
import { useTranslation } from 'react-i18next';

type Props = {
    socket: SocketIOClient.Socket | null;
};

export default function MediaPlayerContainer({ socket }: Props): JSX.Element {
    // Constants
    const uiTimeoutIntervalResolution = 500;
    const uiTimeoutShortDelay = 3000;
    const uiTimeoutLongDelay = 30000;
    const syncStatusIntervalDelay = 1000;
    const syncStatusIntervalTolerance = 1500;
    const actionMessageDelay = 3000;
    const seekStepSize = 5;
    const volumeStepSize = 0.05;

    // Utilities
    const dispatch = useDispatch();
    const { t } = useTranslation();

    // Data from global state
    const party = useSelector((state: RootAppState) => state.globalState.party);
    const user = useSelector((state: RootAppState) => state.globalState.user);
    const uiVisible = useSelector(
        (state: RootAppState) => state.globalState.uiVisible
    );
    const initialServerTimeOffset = useSelector(
        (state: RootAppState) => state.globalState.initialServerTimeOffset
    );

    // Local states & their refs
    const [joinedParty, setJoinedParty] = useState(false);
    const [freshlyJoined, setFreshlyJoined] = useState(true);

    const initialPlayerState = {
        playOrder: null,
        isPlaying: false,
        isFocused: true,
        isSeeking: false,
        isFullScreen: false,
        isSyncing: false,
        isBuffering: false,
        playlistIndex: 0,
        position: 0,
        playingItem: useSelector(
            (state: RootAppState) => state.globalState.playingItem
        ),
        duration: 0,
        sourceUrl: '',
        volume: 1
    };
    const playerStateReducer = (
        playerState: PlayerState,
        updatedProperties: PlayerStateActionProperties
    ): PlayerState => {
        return { ...playerState, ...updatedProperties };
    };
    const [playerState, setPlayerState] = useReducer(
        playerStateReducer,
        initialPlayerState
    );
    const playerStateRef = useRef(playerState);
    playerStateRef.current = playerState;

    const initialPlayerTimeoutState = {
        actionMessageTimeout: null,
        actionMessageTimeoutDone: false,
        uiTimeout: null,
        uiTimeoutDelay: uiTimeoutShortDelay,
        uiTimeoutTimestamp: Date.now()
    };
    const playerTimeoutReducer = (
        playerTimeoutState: PlayerTimeoutState,
        updatedProperties: PlayerTimeoutStateActionProperties
    ): PlayerTimeoutState => {
        return { ...playerTimeoutState, ...updatedProperties };
    };
    const [playerTimeoutState, setPlayerTimeoutState] = useReducer(
        playerTimeoutReducer,
        initialPlayerTimeoutState
    );
    const playerTimeoutStateRef = useRef(playerTimeoutState);
    playerTimeoutStateRef.current = playerTimeoutState;

    // Refs for React Player
    const containerRef = useRef<HTMLDivElement>(null);
    // https://github.com/CookPete/react-player/issues/511
    const playerRef = useRef<ReactPlayer>(null);

    // Clear all timeouts
    const clearAllTimeouts = (): void => {
        if (playerTimeoutStateRef.current.uiTimeout) {
            clearTimeout(playerTimeoutStateRef.current.uiTimeout);
        }
        if (playerTimeoutStateRef.current.actionMessageTimeout) {
            clearTimeout(playerTimeoutStateRef.current.actionMessageTimeout);
        }
    };

    // Player functions

    const handleKeyboardInput = (event: KeyboardEvent): void => {
        if (playerState.isFocused) {
            handleKeyCommands(
                event,
                handlePlayPause,
                handleFullScreen,
                playerState,
                volumeStepSize,
                setPlayerState,
                seekStepSize,
                emitPlayWish
            );
        }
    };

    const getCurrentPosition = (): number | undefined => {
        if (playerRef.current) {
            return (
                playerRef.current.getCurrentTime() /
                playerRef.current.getDuration()
            );
        }
    };

    // Playback functions

    const emitPlayWish = (
        mediaItem: MediaItem,
        isPlaying: boolean,
        newPosition?: number,
        noIssuer?: boolean,
        direction?: 'left' | 'right'
    ): void => {
        if (socket && party && user) {
            const playWish: PlayWish = {
                partyId: party.id,
                issuer: noIssuer ? 'system' : user.id,
                mediaItemId: mediaItem.id,
                type: mediaItem.type,
                isPlaying: isPlaying,
                position:
                    newPosition !== undefined
                        ? newPosition
                        : playerStateRef.current.position,
                timestamp: Date.now()
            };

            if (direction) {
                playWish.direction = direction;
            }

            socket.emit('playWish', playWish);
        }
    };

    // Point currently playing item index to the right item in the playlist
    const updatePlaylistIndex = useCallback(
        (playlistItem: MediaItem): void => {
            if (party && party.items.length) {
                const index = party.items.findIndex(
                    (listItem: MediaItem) => listItem.id === playlistItem.id
                );

                setPlayerState({ playlistIndex: index });
            }
        },
        [party]
    );

    // Effects

    // Attach key event listener
    useEffect(() => {
        document.addEventListener('keydown', handleKeyboardInput);

        return (): void => {
            document.removeEventListener('keydown', handleKeyboardInput);
        };
    });

    // Update playlist index if playingItem in global state changes
    useEffect(() => {
        if (playerState.playingItem) {
            updatePlaylistIndex(playerState.playingItem);
        }
    }, [playerState.playingItem, updatePlaylistIndex]);

    // Emit joinParty when everything is set up; subscribe to play orders; subscribe to syncStatus updates
    useEffect(() => {
        if (socket && party && playerRef.current && user) {
            if (!joinedParty) {
                socket.emit('joinParty', {
                    userId: user.id,
                    partyId: party.id,
                    timestamp: Date.now()
                });

                setJoinedParty(true);
            }

            // Socket 1/3: PlayOrders

            socket.off('playOrder');
            socket.on('playOrder', (playOrder: PlayOrder) => {
                setPlayerState({ playOrder: playOrder, isSyncing: true });

                const playOrderItem = party.items.find((item: MediaItem) => {
                    return item.id === playOrder.mediaItemId;
                });

                if (playOrderItem) {
                    // Set React Player source URL
                    let newSourceUrl;
                    if (playOrder.type === 'file') {
                        newSourceUrl =
                            process.env.REACT_APP_API_ROUTE +
                            'file/' +
                            playOrder.mediaItemId +
                            '?party=' +
                            party.id;
                    } else {
                        newSourceUrl = playOrderItem.url;
                    }

                    // Action message
                    let actionMessageIcon = faClock; // Default case: seeking
                    if (
                        !playerStateRef.current.playingItem ||
                        (playerStateRef.current.playingItem &&
                            playOrder.mediaItemId !==
                                playerStateRef.current.playingItem.id)
                    ) {
                        actionMessageIcon = faExchangeAlt; // Media item change
                    } else if (
                        playOrder.isPlaying !== playerStateRef.current.isPlaying
                    ) {
                        if (playOrder.isPlaying === true) {
                            actionMessageIcon = faPlay; // Pause -> Play
                        } else if (playOrder.isPlaying === false) {
                            actionMessageIcon = faPause; // Play -> Pause
                        }
                    } else {
                        if (playOrder.direction) {
                            if (playOrder.direction === 'left') {
                                actionMessageIcon = faLongArrowAltLeft; // Seek left
                            } else if (playOrder.direction === 'right') {
                                actionMessageIcon = faLongArrowAltRight; // Seek right
                            }
                        }
                    }

                    // None found if issuer === 'system' -> No action message
                    const memberInParty = party.members.find(
                        (member: ClientPartyMember) =>
                            member.id === playOrder.issuer
                    );

                    if (memberInParty) {
                        const actionMessageContent = (
                            <ActionMessageContent
                                text={memberInParty.username}
                                icon={actionMessageIcon}
                            ></ActionMessageContent>
                        );

                        dispatch(
                            setGlobalState({
                                actionMessage: {
                                    text: actionMessageContent
                                }
                            })
                        );
                    }

                    setPlayerState({
                        playingItem: playOrderItem,
                        sourceUrl: newSourceUrl
                    });

                    dispatch(
                        setGlobalState({
                            playingItem: playOrderItem
                        })
                    );

                    updatePlaylistIndex(playOrderItem);
                }
            });

            // Socket 2/3: Receive Sync status

            socket.off('syncStatus');
            socket.on('syncStatus', (syncStatus: SyncStatusIncoming) => {
                const syncStatusStateNew = [] as SyncStatusReceiveMember[];
                const memberStatusStateNew: MemberStatus = {};

                Object.keys(syncStatus).forEach((memberId) => {
                    // 1. Set online status of each member
                    memberStatusStateNew[memberId] = {
                        online: false,
                        serverTimeOffset: syncStatus[memberId].serverTimeOffset
                    };

                    if (
                        syncStatus[user.id] &&
                        syncStatus[memberId] &&
                        syncStatus[memberId].timestamp +
                            syncStatus[memberId].serverTimeOffset >
                            Date.now() +
                                syncStatus[user.id].serverTimeOffset -
                                syncStatusIntervalTolerance
                    ) {
                        memberStatusStateNew[memberId].online = true;
                    }

                    // 2. Calculate delay for every party member who's not us
                    if (syncStatus[user.id] && memberId !== user.id) {
                        const delta = calculateSyncDelta(
                            syncStatus,
                            playerStateRef,
                            user,
                            memberId
                        );

                        const memberInParty = party.members.find(
                            (member: ClientPartyMember) =>
                                member.id === memberId
                        );

                        if (memberInParty) {
                            syncStatusStateNew.push({
                                id: memberId,
                                delta: delta,
                                username: memberInParty.username
                            });
                        }
                    }
                });

                dispatch(
                    setGlobalState({
                        syncStatus: syncStatusStateNew,
                        memberStatus: memberStatusStateNew
                    })
                );
            });
        }

        return (): void => {
            clearAllTimeouts();
        };
    }, [
        dispatch,
        joinedParty,
        user,
        party,
        socket,
        playerRef,
        updatePlaylistIndex
    ]);

    // Sync procedure finish: Seek, isPlaying, start buffering state
    useEffect(() => {
        if (
            playerRef.current &&
            playerState.duration &&
            playerState.playOrder &&
            playerState.isSyncing &&
            playerState.playingItem
        ) {
            let offset = 0;

            if (freshlyJoined) {
                if (playerState.playOrder.isPlaying) {
                    offset =
                        (Date.now() +
                            initialServerTimeOffset -
                            playerState.playOrder.timestamp) /
                        (playerState.duration * 1000);
                }

                setFreshlyJoined(false);
            }

            try {
                playerRef.current.seekTo(
                    playerState.playOrder.position + offset
                ); // FIXME perhaps in lib: 'this.player' is undefined sometimes despite valid playerRef
            } catch (error) {
                dispatch(
                    setGlobalState({ errorMessage: JSON.stringify(error) })
                );
            }

            const site = getSite(playerState.playingItem.url);

            setPlayerState({
                isSeeking: false,
                isPlaying: playerState.playOrder.isPlaying,
                isSyncing: false,
                isBuffering:
                    playerState.playOrder.isPlaying &&
                    playerState.playOrder.type === 'web' &&
                    (site === 'youtube' ||
                        site === 'facebook' ||
                        playerState.playingItem.type === 'file')
            });
        }
    }, [playerState, initialServerTimeOffset, freshlyJoined, dispatch]);

    // Socket 3/3: Emit syncStatus in intervals
    useInterval(() => {
        if (playerRef.current && socket && user && party) {
            const syncStatus: SyncStatusOutgoing = {
                partyId: party.id,
                userId: user.id,
                timestamp: Date.now(),
                position:
                    playerRef.current.getCurrentTime() /
                    playerRef.current.getDuration(),
                isPlaying: playerStateRef.current.isPlaying
            };

            socket.emit('syncStatus', syncStatus);
        }
    }, syncStatusIntervalDelay);

    // React Player Event handlers

    const handleDuration = (duration: number): void => {
        setPlayerState({ duration: duration });
    };

    const handleProgress = (reactPlayerState: ReactPlayerState): void => {
        if (!playerStateRef.current.isSeeking) {
            setPlayerState({
                position: reactPlayerState.played
            });
        }
    };

    const handleVolumeChange = (
        event: React.ChangeEvent<HTMLInputElement>
    ): void => {
        setPlayerState({
            volume: parseFloat(event.target.value)
        });
    };

    const handlePlayPause = (): void => {
        if (playerState.playingItem) {
            if (playerState.isPlaying) {
                emitPlayWish(
                    playerState.playingItem,
                    false,
                    getCurrentPosition()
                );
            } else {
                emitPlayWish(
                    playerState.playingItem,
                    true,
                    getCurrentPosition()
                );
            }
        }
    };

    const handleSeekMouseDown = (): void => {
        setPlayerState({ isSeeking: true });
    };

    const handleSeekChange = (
        event: React.ChangeEvent<HTMLInputElement>
    ): void => {
        setPlayerState({
            position: parseFloat(event.target.value)
        });
    };

    const handleSeekMouseUp = (
        event: React.MouseEvent<HTMLInputElement, MouseEvent>
    ): void => {
        if (playerState.playingItem) {
            emitPlayWish(
                playerState.playingItem,
                playerState.isPlaying,
                parseFloat((event.target as HTMLInputElement).value)
            );
        }
    };

    const handleFullScreen = (): void => {
        (screenfull as Screenfull).toggle();
    };

    const handleReady = (): void => {
        if (!playerState.isPlaying) {
            setPlayerState({
                isBuffering: false
            });
        }
    };

    const handleBufferEnd = (): void => {
        setPlayerState({ isBuffering: false });
    };

    const handleEnd = async (): Promise<void> => {
        if (party && playerState && socket) {
            // 1. Emit playWish for next item in playlist
            if (party.items.length > playerState.playlistIndex + 1) {
                emitPlayWish(
                    party.items[playerState.playlistIndex + 1],
                    playerState.isPlaying,
                    0,
                    true
                );
            } else {
                emitPlayWish(party.items[0], false, 0, true);

                setPlayerState({
                    isPlaying: false
                });
            }

            // 2. Update party meta data: Mark item as played && emit party update order
            if (playerState.playingItem) {
                try {
                    const response = await Axios.put(
                        process.env.REACT_APP_API_ROUTE + 'partyMetadata',
                        {
                            partyId: party.id,
                            metadata: {
                                ...party.metadata,
                                played: {
                                    ...party.metadata.played,
                                    [playerState.playingItem.id]: true
                                }
                            }
                        },
                        axiosConfig()
                    );

                    if (response.data.success) {
                        socket.emit('partyUpdate', { partyId: party.id });
                    } else {
                        dispatch(
                            setGlobalState({
                                errorMessage: t(
                                    `apiResponseMessages.${response.data.msg}`
                                )
                            })
                        );
                    }
                } catch (error) {
                    dispatch(
                        setGlobalState({
                            errorMessage: t('errors.metadataUpdateError')
                        })
                    );
                }
            }
        }
    };

    // UI Event handlers

    // UI movement detection
    const setUiVisible = (visible: boolean): void => {
        dispatch(setGlobalState({ uiVisible: visible }));
    };

    // Prevent UI from hiding when mouse moves
    const handleMouseMovementOverUi = (): void => {
        if (
            Date.now() >
            playerTimeoutState.uiTimeoutTimestamp + uiTimeoutIntervalResolution
        ) {
            setUiVisible(true);

            if (playerTimeoutState.uiTimeout) {
                clearTimeout(playerTimeoutState.uiTimeout);
            }

            setPlayerTimeoutState({
                uiTimeout: setTimeout(() => {
                    setUiVisible(false);
                }, playerTimeoutStateRef.current.uiTimeoutDelay),
                uiTimeoutTimestamp: Date.now()
            });
        }
    };

    // Prevent UI from hiding on certain actions in subcomponents
    const freezeUiVisible = (freeze: boolean): void => {
        const currentDelay = freeze ? uiTimeoutLongDelay : uiTimeoutShortDelay;

        if (playerTimeoutState.uiTimeout) {
            clearTimeout(playerTimeoutState.uiTimeout);
        }

        setPlayerTimeoutState({
            uiTimeout: setTimeout(() => {
                setUiVisible(false);
            }, currentDelay),
            uiTimeoutDelay: currentDelay,
            uiTimeoutTimestamp: Date.now()
        });
    };

    return (
        <div
            ref={containerRef}
            onMouseMove={(): void => {
                handleMouseMovementOverUi();
            }}
            className={'bg-transparent' + (uiVisible ? '' : ' noCursor')}
        >
            <TopBar socket={socket}></TopBar>
            <div
                onMouseDown={handlePlayPause}
                className={'flex w-full h-full reactPlayer'}
            >
                <MediaPlayerOverlay
                    playerState={playerState}
                    playerTimeoutState={playerTimeoutState}
                    setPlayerTimeoutState={(
                        playerTimeoutState: PlayerTimeoutState
                    ): void => setPlayerTimeoutState(playerTimeoutState)}
                    actionMessageDelay={actionMessageDelay}
                ></MediaPlayerOverlay>
                <div className="flex w-full h-full pointer-events-none">
                    <ReactPlayer
                        ref={playerRef}
                        config={{ youtube: { playerVars: { disablekb: 1 } } }}
                        url={playerState.sourceUrl}
                        playing={playerState.isPlaying}
                        volume={playerState.volume}
                        progressInterval={100}
                        onBufferEnd={handleBufferEnd}
                        onDuration={handleDuration}
                        onProgress={handleProgress}
                        onReady={handleReady}
                        onEnded={handleEnd}
                        width="100%"
                        height="100%"
                    ></ReactPlayer>
                </div>
            </div>
            <BottomBar
                playerState={playerState}
                handlePlayPause={handlePlayPause}
                handleSeekMouseDown={handleSeekMouseDown}
                handleSeekChange={handleSeekChange}
                handleSeekMouseUp={handleSeekMouseUp}
                handleVolumeChange={handleVolumeChange}
                handleFullScreen={handleFullScreen}
            ></BottomBar>
            <MediaMenu
                socket={socket}
                playerState={playerState}
                isPlaying={playerState.isPlaying}
                emitPlayWish={emitPlayWish}
                setPlayerFocused={(focused: boolean): void =>
                    setPlayerState({ isFocused: focused })
                }
                freezeUiVisible={freezeUiVisible}
            ></MediaMenu>
        </div>
    );
}
