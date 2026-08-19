import { Router } from "vue-router"
import { RoomId } from "../../../types/Room"
import { useRoomStore } from "../../../stores/room"

export const  joinRoom = async (
  roomId: RoomId,
  router: Router,
  roomStore: ReturnType<typeof useRoomStore>
) => {
  if (roomStore.roomId === roomId 
    && roomStore.connectionStatus !== 'not-connected') {
    return
  }

  try {
    await roomStore.joinRoom(roomId)
  } catch (error) {
    router.push('/multiplayer?message=' + btoa(error))
  }
}