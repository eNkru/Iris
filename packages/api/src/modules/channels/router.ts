import { createChannel } from "./procedures/create";
import { deleteChannel } from "./procedures/delete";
import { listChannels } from "./procedures/list";
import { updateChannel } from "./procedures/update";

export const channelsRouter = {
  list: listChannels,
  create: createChannel,
  update: updateChannel,
  delete: deleteChannel,
};
