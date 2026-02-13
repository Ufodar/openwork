declare const Bun: {
  serve: (options: {
    hostname: string;
    port: number;
    fetch: (request: Request) => Response | Promise<Response>;
    maxRequestBodySize?: number;
  }) => {
    port: number;
  };
  file: (path: string) => unknown;
  write: (path: string, data: unknown) => Promise<number>;
};
