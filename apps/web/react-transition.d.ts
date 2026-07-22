import 'react';

declare module 'react' {
  export function useTransition(): [
    isPending: boolean,
    startTransition: (callback: () => void | Promise<unknown>) => void
  ];
}
