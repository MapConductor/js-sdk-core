import { LocalTileServer } from "./LocalTileServer";

export const TileServerRegistry = {
    private_server: null as LocalTileServer | null,

    get(): LocalTileServer {
        if (!this.private_server) {
            this.private_server = LocalTileServer.startServer();
        }
        return this.private_server;
    },

    warmup(): void {
        this.get();
    },
};
