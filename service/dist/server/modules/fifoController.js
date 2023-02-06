import rb_pgk from 'ring-buffer-ts';
const { RingBuffer } = rb_pgk;
export const getHandler = async (req, res) => {
    return res.status(200).json({
        message: 'Hello'
    });
};
export const postHandler = async (req, res) => {
    const ringBuffer = new RingBuffer(5);
    ringBuffer.add(1);
    ringBuffer.add(2, 3);
    ringBuffer.add(4, 5, 6);
};
