import mongoose from "mongoose"
import User from "./user.js"

const studentSchema = new mongoose.Schema({
  admissionNumber: { type: String, required: true, unique: true },
  admissionDate: { type: Date, required: true },
  status: { type: String, enum: ["active", "inactive"], default: "active" },
  sessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Session",
    required: true
  },
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Class",
    default: null
  },
  rollNumber: { type: String, default: null }, 

  profileImage: { type: String, default: null },
  name: { type: String, required: true },
  dateOfBirth: { type: Date, required: true },
  gender: { type: String, enum: ["male", "female", "other"], required: true },
  bloodGroup: { type: String },
  religion: { type: String },
  category: { type: String },
  motherTongue: { type: String },
  languagesKnown: [{ type: String }],
  fatherInfo: {
    name: { type: String },
    email: { type: String },
    phoneNumber: { type: String },
    occupation: { type: String },
    image: { type: String, default: null }
  },
  motherInfo: {
    name: { type: String },
    email: { type: String },
    phoneNumber: { type: String },
    occupation: { type: String },
    image: { type: String, default: null }
  },
  guardianInfo: {
    name: { type: String },
    relation: { type: String },
    phoneNumber: { type: String },
    email: { type: String },
    occupation: { type: String },
    image: { type: String, default: null }
  },

  currentAddress: { type: String },
  permanentAddress: { type: String },

  transportInfo: {
    route: { type: String },
    vehicleNumber: { type: String },
    pickupPoint: { type: String }
  },

  documents: {
    aadharCard: { type: String, default: null },
    medicalCondition: { type: String, default: null },
    transferCertificate: { type: String, default: null }
  },

  medicalHistory: {
    condition: { type: String, enum: ["good", "bad", "other"] },
    allergies: [{ type: String }],
    medications: [{ type: String }]
  },

  previousSchool: {
    name: { type: String },
    address: { type: String }
  }
})

studentSchema.pre("save", async function(next) {
  const student = this
  const hardcodedPassword = "password" 

  try {
    const createUserIfNotExists = async (info, role) => {
      if (info && info.email) {
        const existingUser = await User.findOne({ email: info.email })
        if (!existingUser) {
          const newUser = new User({
            role,
            name: info.name || "Unnamed Parent/Guardian",
            email: info.email,
            password: hardcodedPassword,
            phone: info.phoneNumber || null,
            status: "active"
          })
          await newUser.save()
          console.log(`Created user for ${role}: ${info.email}`)
        }
      }
    }

    await createUserIfNotExists(student.fatherInfo, "parent")
    await createUserIfNotExists(student.motherInfo, "parent")
    next()
  } catch (error) {
    console.error("Error in pre-save hook:", error)
    next(error) 
  }
})
const Student = mongoose.model("Student", studentSchema)
export default Student
