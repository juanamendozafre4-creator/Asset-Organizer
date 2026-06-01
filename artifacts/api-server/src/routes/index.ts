import { Router, type IRouter } from "express";
import healthRouter from "./health";
import netflixRouter from "./netflix";

const router: IRouter = Router();

router.use(healthRouter);
router.use(netflixRouter);

export default router;
