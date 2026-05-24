import { createSlice } from '@reduxjs/toolkit'

const tokenFromStorage = localStorage.getItem('token') || ''
const userFromStorage = JSON.parse(localStorage.getItem('user') || 'null')

const authSlice = createSlice({
  name: 'auth',
  initialState: {
    token: tokenFromStorage,
    user: userFromStorage,
  },
  reducers: {
    setAuth(state, action) {
      state.token = action.payload.token
      state.user = action.payload.user
      localStorage.setItem('token', action.payload.token)
      localStorage.setItem('user', JSON.stringify(action.payload.user))
    },
    logout(state) {
      state.token = ''
      state.user = null
      localStorage.removeItem('token')
      localStorage.removeItem('user')
    },
  },
})

export const { setAuth, logout } = authSlice.actions
export default authSlice.reducer
