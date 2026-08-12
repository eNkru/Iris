"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpcClient } from "../lib/orpc";

/**
 * Product queries + mutations (frontend/hooks.md). Types are inferred directly
 * from the oRPC client — never redefined (shared/typescript.md).
 */

export type CreateProductInput = Parameters<(typeof orpcClient)["products"]["create"]>[0];
export type CreateProductOutput = Awaited<ReturnType<(typeof orpcClient)["products"]["create"]>>;
export type ProductListItem = Awaited<
  ReturnType<(typeof orpcClient)["products"]["list"]>
>["products"][number];
export type ProductOutput = Awaited<
  ReturnType<(typeof orpcClient)["products"]["get"]>
>["product"];
export type ProductHistory = Awaited<
  ReturnType<(typeof orpcClient)["products"]["get"]>
>["history"];
export type CheckNowOutput = Awaited<ReturnType<(typeof orpcClient)["products"]["checkNow"]>>;

/** Base key for all product list queries — used for broad invalidation. */
export const PRODUCTS_KEY = ["products"] as const;

export function useProducts(active?: boolean) {
  return useQuery({
    queryKey: [...PRODUCTS_KEY, { active: active ?? "all" }],
    queryFn: () => orpcClient.products.list(active !== undefined ? { active } : {}),
    // Keep the home-page list fresh while mounted (R6). Only this query opts in.
    refetchInterval: 30_000,
  });
}

export function useProduct(productId: string) {
  return useQuery({
    queryKey: ["product", productId],
    queryFn: () => orpcClient.products.get({ id: productId }),
    enabled: productId.length > 0,
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();

  return useMutation<CreateProductOutput, Error, CreateProductInput>({
    mutationFn: (input) => orpcClient.products.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY });
    },
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Parameters<(typeof orpcClient)["products"]["update"]>[0]) =>
      orpcClient.products.update(input),
    onSuccess: (_updated, variables) => {
      queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY });
      queryClient.invalidateQueries({ queryKey: ["product", variables.id] });
    },
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => orpcClient.products.delete({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY });
    },
  });
}

export function useCheckNow() {
  const queryClient = useQueryClient();

  return useMutation<CheckNowOutput, Error, { id: string }>({
    mutationFn: ({ id }) => orpcClient.products.checkNow({ id }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY });
      queryClient.invalidateQueries({ queryKey: ["product", variables.id] });
    },
  });
}
