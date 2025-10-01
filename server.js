// ============================================================================
// BACKEND API - Node.js + Express + MongoDB
// ============================================================================

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ============================================================================
// DATABASE CONNECTION
// ============================================================================
mongoose.connect('mongodb://localhost:27017/face-attendance', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// ============================================================================
// DATABASE SCHEMAS
// ============================================================================

// Student Schema
const studentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  rollNo: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  referencePhotos: [{
    data: String,
    timestamp: Date,
    hasDescriptor: Boolean
  }],
  faceDescriptors: [[Number]], // Array of 128-dimensional vectors
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Attendance Schema
const attendanceSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  studentName: String,
  rollNo: String,
  date: String,
  time: String,
  confidence: Number,
  method: String,
  status: { type: String, default: 'Present' },
  imageData: String,
  timestamp: { type: Date, default: Date.now }
});

// User Schema (for authentication)
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'teacher', 'student'], default: 'teacher' },
  createdAt: { type: Date, default: Date.now }
});

const Student = mongoose.model('Student', studentSchema);
const Attendance = mongoose.model('Attendance', attendanceSchema);
const User = mongoose.model('User', userSchema);

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ error: 'Access denied' });
  
  jwt.verify(token, 'your-secret-key', (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

// File Upload Configuration
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// ============================================================================
// AUTHENTICATION ROUTES
// ============================================================================

// Register User
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password, role } = req.body;
    
    // Check if user exists
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    const user = new User({
      username,
      email,
      password: hashedPassword,
      role: role || 'teacher'
    });
    
    await user.save();
    
    res.status(201).json({ 
      message: 'User registered successfully',
      userId: user._id 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Login User
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    
    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id, username: user.username, role: user.role },
      'your-secret-key',
      { expiresIn: '24h' }
    );
    
    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// STUDENT ROUTES
// ============================================================================

// Get All Students
app.get('/api/students', authenticateToken, async (req, res) => {
  try {
    const students = await Student.find().select('-faceDescriptors');
    res.json(students);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Single Student
app.get('/api/students/:id', authenticateToken, async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }
    res.json(student);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create Student
app.post('/api/students', authenticateToken, async (req, res) => {
  try {
    const { name, rollNo, email } = req.body;
    
    // Check if student exists
    const existingStudent = await Student.findOne({ 
      $or: [{ rollNo }, { email }] 
    });
    
    if (existingStudent) {
      return res.status(400).json({ error: 'Student already exists' });
    }
    
    const student = new Student({
      name,
      rollNo,
      email,
      referencePhotos: [],
      faceDescriptors: []
    });
    
    await student.save();
    res.status(201).json(student);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add Reference Photo
app.post('/api/students/:id/photos', authenticateToken, async (req, res) => {
  try {
    const { imageData, faceDescriptor } = req.body;
    
    const student = await Student.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    // Add photo
    student.referencePhotos.push({
      data: imageData,
      timestamp: new Date(),
      hasDescriptor: !!faceDescriptor
    });
    
    // Add descriptor if provided
    if (faceDescriptor) {
      student.faceDescriptors.push(faceDescriptor);
    }
    
    student.updatedAt = new Date();
    await student.save();
    
    res.json(student);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update Student
app.put('/api/students/:id', authenticateToken, async (req, res) => {
  try {
    const student = await Student.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: new Date() },
      { new: true }
    );
    
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    res.json(student);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete Student
app.delete('/api/students/:id', authenticateToken, async (req, res) => {
  try {
    const student = await Student.findByIdAndDelete(req.params.id);
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }
    res.json({ message: 'Student deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// ATTENDANCE ROUTES
// ============================================================================

// Get All Attendance
app.get('/api/attendance', authenticateToken, async (req, res) => {
  try {
    const { date, studentId, limit = 50 } = req.query;
    
    let query = {};
    if (date) query.date = date;
    if (studentId) query.studentId = studentId;
    
    const attendance = await Attendance.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .populate('studentId', 'name rollNo email');
    
    res.json(attendance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create Attendance Record
app.post('/api/attendance', authenticateToken, async (req, res) => {
  try {
    const { studentId, studentName, rollNo, confidence, method, imageData } = req.body;
    
    const now = new Date();
    const attendance = new Attendance({
      studentId,
      studentName,
      rollNo,
      date: now.toISOString().split('T')[0],
      time: now.toLocaleTimeString(),
      confidence,
      method,
      imageData,
      status: 'Present'
    });
    
    await attendance.save();
    res.status(201).json(attendance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Batch Create Attendance (for multiple students)
app.post('/api/attendance/batch', authenticateToken, async (req, res) => {
  try {
    const { attendanceRecords } = req.body;
    
    const records = attendanceRecords.map(record => ({
      ...record,
      timestamp: new Date()
    }));
    
    const createdRecords = await Attendance.insertMany(records);
    res.status(201).json(createdRecords);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Attendance Statistics
app.get('/api/attendance/stats', authenticateToken, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const totalStudents = await Student.countDocuments();
    const todayAttendance = await Attendance.distinct('studentId', { date: today });
    const presentToday = todayAttendance.length;
    
    const avgConfidence = await Attendance.aggregate([
      { $match: { date: today } },
      { $group: { _id: null, avgConf: { $avg: '$confidence' } } }
    ]);
    
    res.json({
      totalStudents,
      presentToday,
      attendanceRate: totalStudents > 0 ? (presentToday / totalStudents * 100) : 0,
      avgConfidence: avgConfidence[0]?.avgConf * 100 || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export Attendance to CSV
app.get('/api/attendance/export', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let query = {};
    if (startDate && endDate) {
      query.date = { $gte: startDate, $lte: endDate };
    }
    
    const attendance = await Attendance.find(query).sort({ timestamp: -1 });
    
    // Convert to CSV
    const csvHeader = 'Date,Time,Student Name,Roll No,Confidence,Method,Status\n';
    const csvData = attendance.map(record => 
      `${record.date},${record.time},${record.studentName},${record.rollNo},${(record.confidence * 100).toFixed(1)}%,${record.method},${record.status}`
    ).join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=attendance.csv');
    res.send(csvHeader + csvData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// FACE RECOGNITION ROUTE
// ============================================================================

// Process Face Recognition
app.post('/api/recognize', authenticateToken, async (req, res) => {
  try {
    const { imageData, detectedDescriptors } = req.body;
    
    // Get all students with face descriptors
    const students = await Student.find({ 
      faceDescriptors: { $exists: true, $ne: [] } 
    });
    
    const matches = [];
    
    for (const descriptor of detectedDescriptors) {
      let bestMatch = null;
      let bestDistance = Infinity;
      const threshold = 0.6;
      
      for (const student of students) {
        for (const storedDescriptor of student.faceDescriptors) {
          // Calculate Euclidean distance
          const distance = euclideanDistance(descriptor, storedDescriptor);
          
          if (distance < threshold && distance < bestDistance) {
            bestDistance = distance;
            bestMatch = {
              student: {
                id: student._id,
                name: student.name,
                rollNo: student.rollNo,
                email: student.email
              },
              confidence: 1 - distance,
              distance
            };
          }
        }
      }
      
      if (bestMatch) {
        matches.push(bestMatch);
      }
    }
    
    res.json({ matches });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper function for Euclidean distance
function euclideanDistance(arr1, arr2) {
  let sum = 0;
  for (let i = 0; i < arr1.length; i++) {
    sum += Math.pow(arr1[i] - arr2[i], 2);
  }
  return Math.sqrt(sum);
}

// ============================================================================
// SERVER START
// ============================================================================

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📊 Database connected to MongoDB`);
});

module.exports = app;