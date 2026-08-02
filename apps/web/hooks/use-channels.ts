"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpcClient } from "../lib/orpc";

/**
 * Alert channel queries + mutations (R11/R12).
 */

export type Channel = Awaited<
  ReturnType<(typeof orpcClient)["channels"]["list"]>
>["channels"][number];

export const CHANNELS_KEY = ["channels"] as const;

export function useChannels() {
  return useQuery({
    queryKey: CHANNELS_KEY,
    queryFn: () => orpcClient.channels.list(),
  });
}

export function useCreateChannel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Parameters<(typeof orpcClient)["channels"]["create"]>[0]) =>
      orpcClient.channels.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CHANNELS_KEY });
    },
  });
}

export function useUpdateChannel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Parameters<(typeof orpcClient)["channels"]["update"]>[0]) =>
      orpcClient.channels.update(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CHANNELS_KEY });
    },
  });
}

export function useDeleteChannel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => orpcClient.channels.delete({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CHANNELS_KEY });
    },
  });
}
