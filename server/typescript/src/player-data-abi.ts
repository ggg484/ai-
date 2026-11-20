/** `builda:player-data/player-data-api@1.0.0`; all IDs are source-local. */
export const ASYNC_SOURCE_PLAYER_DATA = 4;
export type PlayerDataId = {
    id: bigint;
};
export type PlayerDataBitsValue = {
    tag: "bool-value";
    val: boolean;
} | {
    tag: "int64-bits" | "float64-bits";
    val: bigint;
} | {
    tag: "string-value";
    val: string;
} | {
    tag: "bytes-inline";
    val: {
        data: Uint8Array;
    };
} | {
    tag: "object-cbor";
    val: Uint8Array;
};
export type PlayerDataHostRead = {
    value?: PlayerDataBitsValue;
    valueRevision: bigint;
    schemaId: string;
    schemaVersion: number;
};
export type PlayerDataHostDecision = {
    tag: "set";
    val: {
        value: PlayerDataBitsValue;
        schemaId: string;
        schemaVersion: number;
    };
} | {
    tag: "delete" | "keep" | "callback-abort";
};
export type PlayerDataHostFailure = {
    code: string;
    requestId: string;
    recovery?: PlayerDataId;
    recoveryError?: string;
};
export type PlayerDataHostWrite = {
    status: "applied" | "unchanged";
    valueRevision: bigint;
};
export type PlayerDataHostClose = {
    tag: "closed";
} | {
    tag: "pending";
    val: Array<{
        requestId: string;
        recovery?: PlayerDataId;
    }>;
};
export type PlayerDataHostPoll = {
    tag: "pending";
} | {
    tag: "read";
    val: PlayerDataHostRead;
} | {
    tag: "needs-transform";
    val: {
        readGeneration: bigint;
        current: PlayerDataHostRead;
    };
} | {
    tag: "written";
    val: PlayerDataHostWrite;
} | {
    tag: "closed";
    val: PlayerDataHostClose;
} | {
    tag: "failed";
    val: PlayerDataHostFailure;
};
/** Imports use the normal Component result convention (throw the declared error). */
export interface PlayerDataHost {
    playerDataOpen(roleId: string): PlayerDataId;
    playerDataStart(target: PlayerDataId, key: string, kind: "read" | "update", timeoutMs: number): PlayerDataId;
    playerDataPoll(operation: PlayerDataId): PlayerDataHostPoll;
    playerDataPropose(operation: PlayerDataId, readGeneration: bigint, proposal: PlayerDataHostDecision): void;
    playerDataCloseStart(target: PlayerDataId, timeoutMs: number): PlayerDataId;
    playerDataResume(recovery: PlayerDataId, timeoutMs: number): PlayerDataId;
    playerDataReleaseOperation(operation: PlayerDataId): void;
    playerDataReleaseTarget(target: PlayerDataId): void;
    playerDataReleaseRecovery(recovery: PlayerDataId): void;
}
