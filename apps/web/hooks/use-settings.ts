"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpcClient } from "../lib/orpc";

/**
 * User settings + admin global settings queries/mutations (R6/R7).
 */

export type UserSettings = Awaited<ReturnType<(typeof orpcClient)["settings"]["get"]>>;
export type GlobalSettings = Awaited<
  ReturnType<(typeof orpcClient)["admin"]["globalSettings"]["get"]>
>;

export const USER_SETTINGS_KEY = ["settings", "user"] as const;
export const GLOBAL_SETTINGS_KEY = ["settings", "global"] as const;

export function useUserSettings() {
  return useQuery({
    queryKey: USER_SETTINGS_KEY,
    queryFn: () => orpcClient.settings.get(),
  });
}

export function useUpdateUserSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Parameters<(typeof orpcClient)["settings"]["update"]>[0]) =>
      orpcClient.settings.update(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USER_SETTINGS_KEY });
    },
  });
}

export function useGlobalSettings() {
  return useQuery({
    queryKey: GLOBAL_SETTINGS_KEY,
    queryFn: () => orpcClient.admin.globalSettings.get(),
    retry: false,
  });
}

export function useUpdateGlobalSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (
      input: Parameters<(typeof orpcClient)["admin"]["globalSettings"]["update"]>[0],
    ) => orpcClient.admin.globalSettings.update(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GLOBAL_SETTINGS_KEY });
    },
  });
}
