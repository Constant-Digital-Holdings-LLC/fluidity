import express, { Request, Response } from 'express';
// import { RingBuffer } from 'ring-buffer-ts';
import rb_pgk from 'ring-buffer-ts';
const { RingBuffer } = rb_pgk;

export const getHandler = async (req: Request, res: Response) => {
    // logger.info(ringBuffer.toArray());

    return res.status(200).json({
        message: 'Hello'
    });
};

export const postHandler = async (req: Request, res: Response) => {
    const ringBuffer = new RingBuffer<number>(5);
    ringBuffer.add(1);
    ringBuffer.add(2, 3);
    ringBuffer.add(4, 5, 6);
};
