declare module 'JSCPP' {
  interface JSCPPConfig {
    stdio?: {
      write?: (str: string) => void;
      drain?: () => string;
    };
    maxTimeout?: number;
    unsigned_overflow?: 'error' | 'warn' | 'ignore';
  }

  interface JSCPPModule {
    run: (code: string, input?: string, config?: JSCPPConfig) => number;
  }

  const JSCPP: JSCPPModule;
  export default JSCPP;
  export const run: JSCPPModule['run'];
}
