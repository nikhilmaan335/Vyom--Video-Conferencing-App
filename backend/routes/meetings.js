const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Meeting = require('../models/Meeting');
const auth = require('../middleware/auth');

const router = express.Router();

router.post('/create', auth, async (req, res) => {
  try {
    const title = req.body.title?.trim() || 'Vyom Meeting';
    const roomId = uuidv4().slice(0, 8);

    const meeting = await Meeting.create({
      roomId,
      title,
      host: req.user._id,
      participants: [req.user._id],
    });

    res.status(201).json({
      roomId: meeting.roomId,
      title: meeting.title,
      joinUrl: `/room/${meeting.roomId}`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/history', auth, async (req, res) => {
  try {
    const meetings = await Meeting.find({
      $or: [{ host: req.user._id }, { participants: req.user._id }],
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .select('roomId title createdAt startedAt endedAt');

    res.json({ meetings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:roomId', async (req, res) => {
  try {
    const meeting = await Meeting.findOne({ roomId: req.params.roomId }).populate('host', 'name');
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }
    res.json({
      roomId: meeting.roomId,
      title: meeting.title,
      hostName: meeting.host?.name || 'Host',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
