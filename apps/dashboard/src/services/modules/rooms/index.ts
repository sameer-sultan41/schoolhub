import { createRoom, deleteRoom, fetchRoomPage, updateRoom } from "./rooms-service";

export const RoomsService = {
  fetchRoomPage,
  createRoom,
  updateRoom,
  deleteRoom,
};
export type { RoomInput, RoomPageQuery, RoomRecord, RoomType } from "./rooms-type";
