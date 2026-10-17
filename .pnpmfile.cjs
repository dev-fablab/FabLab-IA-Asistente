// Ajustes de resolución de dependencias del monorepo.
module.exports = {
  hooks: {
    readPackage(pkg) {
      // drizzle-orm se usa aquí solo con `postgres`. `pg` es un peer opcional suyo, pero lo instala
      // `@mastra/pg` (el storage de Mastra lo usa por su cuenta, sin pasar por drizzle). Si drizzle
      // declara `pg` como peer, pnpm crea dos copias de drizzle-orm (con y sin `pg`) y los tipos de
      // `@fablab/db` y `@fablab/agent` dejan de ser compatibles entre sí.
      if (pkg.name === 'drizzle-orm') {
        delete pkg.peerDependencies?.pg;
        delete pkg.peerDependenciesMeta?.pg;
      }
      return pkg;
    },
  },
};
