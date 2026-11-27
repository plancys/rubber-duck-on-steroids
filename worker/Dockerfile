# The image of the background worker. It holds only the worker/ folder and its production packages.
# Node runs the TypeScript files directly, so the image needs no build step.
# The Node major version matches .nvmrc. Change both together.
FROM node:26-slim

# Crawlee starts the ps program to measure the memory of the worker before it reads a page. The slim image has no
# ps, and each course load then fails with "spawn ps ENOENT". The procps package holds ps.
RUN apt-get update && apt-get install -y --no-install-recommends procps && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# The packages come first, so a change to the code does not install them again.
# No package needs an install script, so npm runs none.
# The files stay owned by root, so the worker cannot change its own code or its packages.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY . .

# The official Node image has the user "node". The worker does not run as root.
USER node

# The worker reads PORT. Cloud Run sets it. Without it, the worker listens on 8788.
EXPOSE 8788
CMD ["node", "main.ts"]
