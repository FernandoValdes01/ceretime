declare module "bun:test" {
  interface Matchers {
    toBe(expected: unknown): void;
    toBeNull(): void;
    toEqual(expected: unknown): void;
    toHaveLength(expected: number): void;
  }

  export function expect<T>(value: T): Matchers;
  export function test(name: string, callback: () => void | Promise<void>): void;
}

declare module "react-test-renderer" {
  export interface ReactTestRenderer {
    root: {
      findByType(type: (props: { readonly value: unknown }) => null): {
        readonly props: { readonly value: unknown };
      };
    };
    update(element: import("react").ReactElement): void;
    unmount(): void;
  }

  export function act(callback: () => void | Promise<void>): void | Promise<void>;

  const TestRenderer: {
    create(element: import("react").ReactElement): ReactTestRenderer;
  };
  export default TestRenderer;
}
