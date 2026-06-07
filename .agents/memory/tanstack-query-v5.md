---
name: TanStack Query v5 breaking changes
description: Key API changes in React Query v5 that affect this project
---

# TanStack Query v5: onError removed from useQuery

## The Rule
`onError` in `useQuery` / `useGetXxx` query options was **removed** in TanStack Query v5.

## Why
React Query v5 removed side-effect callbacks from query options (`onSuccess`, `onError`, `onSettled`).
These are still available on `useMutation` options.

## How to Apply
For redirect-on-error patterns, use `useEffect` + `isError`:

```tsx
const { data, isError } = useGetMe({ query: { retry: false } });

useEffect(() => {
  if (isError) setLocation("/login");
}, [isError, setLocation]);
```

Do NOT write:
```tsx
// ❌ This silently does nothing in v5
useGetMe({ query: { onError: () => redirect() } });
```
