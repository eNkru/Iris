import { getGlobalSettingsProcedure } from "./procedures/get-global-settings";
import { updateGlobalSettingsProcedure } from "./procedures/update-global-settings";

export const adminRouter = {
  globalSettings: {
    get: getGlobalSettingsProcedure,
    update: updateGlobalSettingsProcedure,
  },
};
