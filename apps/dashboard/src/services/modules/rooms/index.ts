import {
  createRoom,
  deleteRoom,
  fetchActiveRooms,
  fetchRoomPage,
  updateRoom,
} from "./rooms-service";

export const RoomsService = {
  fetchRoomPage,
  fetchActiveRooms,
  createRoom,
  updateRoom,
  deleteRoom,
};
export type { RoomInput, RoomPageQuery, RoomRecord, RoomType } from "./rooms-type";
