import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** The PERPL_MANAGERS address behind the bearer token, set by the /perp guard. */
    perpAddress?: string;
  }
}
