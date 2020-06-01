import { SET_GLOBAL_STATE } from './actionTypes';
import { AppAction, GlobalStateActionProperties } from '../types';

export const setGlobalState = (
    globalStateProperties: GlobalStateActionProperties
): AppAction => {
    return {
        type: SET_GLOBAL_STATE,
        globalStateProperties
    };
};
