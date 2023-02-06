import { Router } from 'express';
import { getHandler, postHandler } from './fifoController.js';

export const router = Router();

router.get('/', (req, res) => {
    res.render('index');
});

router.get('/FIFO', getHandler);
router.post('/FIFO', postHandler);
