# The image of the topic engine. It holds only the engine code and its locked production packages.
# The Python version matches .python-version. Change both together.
FROM python:3.12-slim

# uv installs the locked packages. The uv version matches the uv version of the smoke job in .github/workflows/ci.yml.
# Change both together.
COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /bin/uv

WORKDIR /app
# uv compiles the packages to bytecode at build time, so that a cold start imports Cognee faster.
# uv copies the files into the environment, uses the Python of the base image, and keeps no download cache in the image.
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_NO_CACHE=1
# The packages come first, so that a change to the code does not install them again.
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project
COPY rubber_duck_engine ./rubber_duck_engine

# The engine does not run as root. The files stay owned by root, so the engine cannot change its own code or packages.
# The user has a home folder, because some packages write a cache there. The engine writes its own files to /tmp.
RUN useradd --create-home --uid 10001 engine
USER engine

ENV PATH="/app/.venv/bin:$PATH"
# The engine reads PORT. Cloud Run sets it. Without it, the engine listens on 8790, on all addresses.
# The engine also needs ENGINE_SECRET and LLM_API_KEY at run time. The image holds no secret.
EXPOSE 8790
CMD ["python", "-m", "rubber_duck_engine.app"]
