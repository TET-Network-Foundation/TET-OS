export default {
  testEnvironment: "node",
  transform: {
    "^.+\\.(t|j)sx?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "<rootDir>/tsconfig.jest.json",
      },
    ],
  },
  extensionsToTreatAsEsm: [".ts"],
  // `src/` is NodeNext ESM, so its internal imports carry the `.js` extension the compiler emits.
  // Under jest those files are still `.ts`; map the extension away so a test can import the
  // sources directly instead of testing a stale `dist/`.
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
};
