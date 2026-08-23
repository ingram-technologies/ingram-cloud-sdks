/** The wire's Zod schema map — the hand-authored schemas in ./zod, keyed by
 *  export name. Source of truth; consumed by the api test suite to validate
 *  wire shapes. (Replaces the former openapi-zod-client-generated file.) */
export * as schemas from "./zod/index.js";
