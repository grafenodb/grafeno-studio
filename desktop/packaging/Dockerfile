# Builds Grafeno Desktop's Linux packages (.deb and .rpm) in a container,
# from the repository's root:
#
#   docker build -f desktop/packaging/Dockerfile --output dist/desktop .
#
# Debian 12's glibc (2.36): the packages run on it and on anything newer.
FROM node:24-bookworm AS build
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev \
       build-essential curl file rpm \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
ENV PATH="/root/.cargo/bin:${PATH}"
WORKDIR /src
COPY studio/package.json studio/package-lock.json studio/
RUN npm ci --prefix studio --no-audit --no-fund
COPY desktop/package.json desktop/package-lock.json desktop/
RUN npm ci --prefix desktop --no-audit --no-fund
COPY . .
RUN npm run build --prefix studio
RUN --mount=type=cache,target=/root/.cargo/registry \
    --mount=type=cache,target=/src/desktop/target \
    cd desktop && npx tauri build --bundles deb,rpm \
    && mkdir -p /out \
    && cp target/release/bundle/deb/*.deb target/release/bundle/rpm/*.rpm /out/ \
    && ls -l /out

FROM scratch
COPY --from=build /out /
