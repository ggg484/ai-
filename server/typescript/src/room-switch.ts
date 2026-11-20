import { currentRoomHost } from "./host.ts";
import type { RoomContext } from "./types.ts";

export type RoomSwitchRequest = {
  requestId: string;
  matchKey: string;
  roleIds: string[];
};

export type RoomSwitchPhase = "rejected" | "status_unknown" | "submitting" | "preparing" | "connecting" | "freezing"
  | "committed" | "activating" | "completed" | "cancelling" | "cancelled" | "failed_after_commit";

export type RoomSwitchStatus = {
  switchId: string;
  phase: RoomSwitchPhase;
  sourceRoomId: string;
  targetRoomId?: string;
  errorCode?: string;
};

export type RoomSwitchOrigin = {
  kind: "room_switch";
  switchId: string;
  sourceRoomId: string;
  roleIds: readonly string[];
};

export class RoomSwitchError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "RoomSwitchError";
  }
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
}

/** 校验与复制请求，调用后的数组变更不能改变已提交名单。 */
export function normalizeRoomSwitch(request: RoomSwitchRequest): RoomSwitchRequest {
  if (!request || !identifier(request.requestId) || !identifier(request.matchKey)
    || !Array.isArray(request.roleIds) || request.roleIds.length < 1 || request.roleIds.length > 50
    || request.roleIds.some((id) => !identifier(id))) {
    throw new RoomSwitchError("ROOM_SWITCH_INVALID_REQUEST");
  }
  const roleIds = [...request.roleIds].sort();
  if (new Set(roleIds).size !== roleIds.length) throw new RoomSwitchError("ROOM_SWITCH_DUPLICATE_MEMBER");
  return { requestId: request.requestId, matchKey: request.matchKey, roleIds };
}

/** 读取平台注入的创建来源；用户自定义 roomParameters 不能伪造平台来源。 */
export function roomSwitchOrigin(context: RoomContext): RoomSwitchOrigin | undefined {
  let launch: { room_switch?: { switch_id?: unknown; source_room_id?: unknown; role_ids?: unknown } };
  try { launch = JSON.parse(context.launchContextJson); }
  catch { throw new RoomSwitchError("ROOM_SWITCH_CONTEXT_INVALID"); }
  const origin = launch?.room_switch;
  if (origin === undefined || origin === null) return undefined;
  if (typeof origin.switch_id !== "string" || !origin.switch_id
    || typeof origin.source_room_id !== "string" || !origin.source_room_id
    || !Array.isArray(origin.role_ids) || origin.role_ids.length < 1 || origin.role_ids.length > 50
    || origin.role_ids.some((id) => !identifier(id))
    || new Set(origin.role_ids).size !== origin.role_ids.length) {
    throw new RoomSwitchError("ROOM_SWITCH_CONTEXT_INVALID");
  }
  return Object.freeze({ kind: "room_switch", switchId: origin.switch_id,
    sourceRoomId: origin.source_room_id, roleIds: Object.freeze([...origin.role_ids]) });
}

/** 句柄只读取执行进度；丢弃句柄不会取消已受理的转场。 */
export class RoomSwitchOperation {
  constructor(readonly switchId: string) {}

  poll(): RoomSwitchStatus {
    const host = currentRoomHost();
    if (!host?.roomSwitchPoll) throw new RoomSwitchError("ROOM_SWITCH_CAPABILITY_UNAVAILABLE");
    return host.roomSwitchPoll(this.switchId);
  }
}

/** 仅发起平台操作，不阻塞 Room tick；受理和完成必须通过状态区分。 */
export function createRoomAndTransfer(request: RoomSwitchRequest): RoomSwitchOperation {
  const normalized = normalizeRoomSwitch(request);
  const host = currentRoomHost();
  if (!host?.roomSwitchStart || !host.roomSwitchPoll) {
    throw new RoomSwitchError("ROOM_SWITCH_CAPABILITY_UNAVAILABLE");
  }
  return new RoomSwitchOperation(host.roomSwitchStart(normalized));
}
