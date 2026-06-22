import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import tilesRouter from "./tiles.js";
import layoutRouter from "./layout.js";
import uploadsRouter from "./uploads.js";
import widgetsRouter from "./widgets.js";
import connectionsRouter from "./connections.js";
import spotifyRouter from "./spotify.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/tiles/layout", layoutRouter);
router.use("/tiles", tilesRouter);
router.use("/uploads", uploadsRouter);
router.use("/widgets", widgetsRouter);
// Spotify's dedicated OAuth + control endpoints. Mounted before the generic
// connections router so its specific paths win over /connections/:service.
router.use("/connections/spotify", spotifyRouter);
router.use("/connections", connectionsRouter);

export default router;
