"use client";

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
} from "react";

/**
 * Small Tailwind-styled primitives shared across pages. Kept intentionally
 * dependency-free (no clsx/tailwind-merge) — plain template strings.
 */

export function Button({
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    />
  );
}

export function ButtonSecondary({
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    />
  );
}

export function ButtonDanger({
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    />
  );
}

export function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 ${className}`}
      {...props}
    />
  );
}

export function Label({
  className = "",
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={`mb-1 block text-sm font-medium text-slate-700 ${className}`}
      {...props}
    />
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500">
      <span
        className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600"
        aria-hidden
      />
      {label ? <span>{label}</span> : null}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      {message}
    </div>
  );
}

export function SuccessBox({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
    >
      {message}
    </div>
  );
}

export function formatPrice(price: number, currency: string | null): string {
  const amount = price.toFixed(2);
  return currency ? `${currency} ${amount}` : amount;
}

export function formatDateTime(date: Date | null): string {
  if (!date) {
    return "—";
  }
  return date.toLocaleString();
}
