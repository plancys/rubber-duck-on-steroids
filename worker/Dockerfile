# The image of the background worker. It holds only the worker/ folder.
# Node runs the TypeScript files directly, so the image needs no build step and no package.
# The Node major version matches .nvmrc. Change both together.
FROM node:26-slim

WORKDIR /app
# The files stay owned by root, so the worker cannot change its own code.
COPY . .

# The official Node image has the user "node". The worker does not run as root.
USER node

# The worker reads PORT. Cloud Run sets it. Without it, the worker listens on 8788.
EXPOSE 8788
CMD ["node", "main.ts"]
