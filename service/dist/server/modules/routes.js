import { Router } from 'express';
import { GET, POST } from './controller.js';
export const router = Router();
router.get('/', (req, res) => {
    res.render('index');
});
router.get('/FIFO', GET);
router.post('/FIFO', POST);
