import express from "express";
import { applyLeave, getLeaves, updateLeaveStatus } from "../controllers/leaveController.js";
import authMiddleware from "../middleware/auth.js";

const router = express.Router();

router.post("/apply", authMiddleware(["admin", "parent", "teacher"]), applyLeave); // Parent applies for leave
router.get("/", authMiddleware(["admin", "parent", "teacher"]), getLeaves); // Parents & Admins view leaves
router.put("/update", authMiddleware(["admin", "parent", "teacher"]), updateLeaveStatus); // Teachers/Admins update status

export default router;