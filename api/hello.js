module.exports = function handler(req, res) {
    res.status(200).json({ hello: 'world', time: new Date().toISOString() });
};
