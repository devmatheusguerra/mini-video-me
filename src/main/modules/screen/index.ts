import { BrowserWindow, screen as _screen, Rectangle } from 'electron'

import { userPreferences } from 'shared/store'
import { PLATFORM } from 'shared/constants'
import { getAllDisplays } from './displays'
import { Sizes } from 'shared/types'

export interface ScreenProportions {
  initial: Sizes
  large: Sizes
}

export type ScreenMovement = 'left' | 'right' | 'top' | 'bottom'
export type ScreenSize = 'initial' | 'large'

export type ScreenEdge =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

export type ScreenEdgeMovements = Record<
  ScreenEdge,
  Partial<Record<ScreenMovement, ScreenEdge>>
>

export class ScreenModule {
  private window: BrowserWindow
  private currentScreenSize: ScreenSize
  private currentScreenEdge: ScreenEdge
  private currentDisplayId: number
  private screenSizes: ScreenProportions
  private isScreenVisible = true
  private currentX = 0
  private currentY = 0
  private isMoving = false
  private smoothing = userPreferences.store.camera.smoothing
  private speed = userPreferences.store.camera.speed
  private windowPositionByScreenSize: Record<
    ScreenSize,
    { x: number; y: number }
  >

  constructor(
    window: BrowserWindow,
    initialScreenSize: ScreenSize = 'initial',
    initialScreenEdge: ScreenEdge = 'bottom-right'
  ) {
    this.window = window
    this.currentScreenEdge = initialScreenEdge
    this.currentScreenSize = initialScreenSize

    const currentWindowBounds = this.window.getBounds()

    this.currentDisplayId = _screen.getDisplayMatching(currentWindowBounds).id

    const {
      store: { screen },
    } = userPreferences

    this.screenSizes = {
      initial: {
        width: screen.initial.width,
        height: screen.initial.height,
      },

      large: {
        width: screen.large.width,
        height: screen.large.height,
      },
    }

    const { x, y } = this.window.getBounds()

    this.windowPositionByScreenSize = {
      initial: { x, y },
      large: { x, y },
    }

    this.setCurrentWindowXY()
  }

  getAllDisplays() {
    return getAllDisplays()
  }

  getActiveDisplay() {
    return this.currentDisplayId
  }

  setActiveDisplay(displayId: number) {
    const display = this.getDisplayById(displayId)

    if (!display) return

    this.currentDisplayId = displayId
  }

  setActiveDisplayByWindowPosition() {
    const { detectedDisplayIdByWindowPosition } =
      this.getDisplayByWindowPosition()

    this.setActiveDisplay(detectedDisplayIdByWindowPosition)
  }

  getDisplayById(id: number): Electron.Display {
    const display = this.getAllDisplays().find((display) => display.id === id)

    return display
  }

  getDisplayByWindowPosition() {
    const activeDisplay = this.getActiveDisplay()
    const bounds = this.window.getBounds()

    const detectedDisplayIdByWindowPosition =
      _screen.getDisplayNearestPoint(bounds).id

    const isOnSameScreen = detectedDisplayIdByWindowPosition === activeDisplay

    return { detectedDisplayIdByWindowPosition, isOnSameScreen }
  }

  getScreenSizeInPixels() {
    const { width, height } = this.screenSizes[this.currentScreenSize]

    return {
      width,
      height,
    }
  }

  getCurrentScreenSize() {
    return this.currentScreenSize
  }

  getCurrentScreenEdge() {
    return this.currentScreenEdge
  }

  setWindowPositionByScreenSize() {
    this.windowPositionByScreenSize[this.currentScreenSize] = {
      x: this.currentX,
      y: this.currentY,
    }
  }

  setCurrentWindowXY() {
    this.currentX = this.window.getBounds().x
    this.currentY = this.window.getBounds().y
  }

  setWindowSize(size: ScreenSize) {
    if (this.currentScreenSize === size) {
      return
    }

    this.currentScreenSize = size
    this.memoLastWindowPosition()

    const { width, height } = this.getScreenSizeInPixels()
    const { x, y } = this.windowPositionByScreenSize[size]

    this.window.setMaximumSize(width, height)
    this.setWindowBounds({ width, height, x, y })
  }

  setWindowBounds(bounds: Partial<Rectangle>) {
    PLATFORM.IS_MAC
      ? this.window.setBounds(bounds, true)
      : this.window.setBounds(bounds)
  }

  updateWindowPosition() {
    const display = this.getDisplayById(this.currentDisplayId)

    this.window.setPosition(display.workArea.x, display.workArea.y)
    this.moveWindowToScreenEdge()
  }

  memoLastWindowPosition() {
    this.setWindowPositionByScreenSize()
    this.setCurrentWindowXY()
  }

  calculateScreenMovement(movement: ScreenMovement) {
    const edgeMovements: ScreenEdgeMovements = {
      'top-right': {
        left: 'top-left',
        bottom: 'bottom-right',
      },

      'top-left': {
        right: 'top-right',
        bottom: 'bottom-left',
      },

      'bottom-right': {
        left: 'bottom-left',
        top: 'top-right',
      },

      'bottom-left': {
        right: 'bottom-right',
        top: 'top-left',
      },
    }

    return (
      edgeMovements[this.currentScreenEdge][movement] || this.currentScreenEdge
    )
  }

  calculateWindowCenterPosition() {
    const { bounds } = this.getDisplayById(this.getActiveDisplay())
    const { width, height } = this.getScreenSizeInPixels()

    const x = Math.round(bounds.x + (bounds.width - width) / 2)
    const y = Math.round(bounds.y + (bounds.height - height) / 2)

    return { x, y }
  }

  moveSmoothing(edge = this.currentScreenEdge) {
    this.isMoving = true
    this.currentScreenEdge = edge

    const { x, y } = this.window.getBounds()
    const display = _screen.getDisplayNearestPoint({ x, y })
    const bounds = { x: display.bounds.x, y: display.bounds.y }
    const { width, height } = this.getScreenSizeInPixels()
    let time = Math.trunc(Math.abs(60 * (1 - this.speed)))
    time = time > 60 ? 1 : time

    const SCREEN_PADDING = 24

    switch (edge) {
      case 'top-left':
        bounds.x += SCREEN_PADDING
        bounds.y += SCREEN_PADDING
        break

      case 'bottom-left':
        bounds.x += SCREEN_PADDING
        bounds.y += display.size.height - height - SCREEN_PADDING
        break

      case 'top-right':
        bounds.x += display.size.width - width - SCREEN_PADDING
        bounds.y += SCREEN_PADDING
        break

      case 'bottom-right':
        bounds.x += display.size.width - width - SCREEN_PADDING
        bounds.y += display.size.height - height - SCREEN_PADDING
        break
    }

    const intervalo = setInterval(() => {
      const { x, y } = this.window.getBounds()

      if (x === bounds.x && y === bounds.y) {
        this.isMoving = false
        return clearInterval(intervalo)
      }

      const toUP = bounds.y < y
      const toLEFT = bounds.x < x
      const distance_x = Math.abs(bounds.x - x)
      const distance_y = Math.abs(bounds.y - y)
      const distance = Math.max(distance_x, distance_y)
      const step = Math.max(5, Math.trunc(distance * this.speed))
      const variation = step + 10
      let temp_y
      let temp_x
      if (x !== bounds.x || y !== bounds.y) {
        if (toUP) {
          if (Math.abs(y - bounds.y) > step + variation) temp_y = y - step
          else temp_y = y
        } else {
          if (Math.abs(y - bounds.y) > step + variation) temp_y = y + step
          else temp_y = y
        }

        if (toLEFT) {
          if (Math.abs(x - bounds.x) > step + variation) temp_x = x - step
          else temp_x = x
        } else {
          if (Math.abs(x - bounds.x) > step + variation) temp_x = x + step
          else temp_x = x
        }
      }
      this.setWindowBounds({ x: temp_x, y: temp_y })

      // Clear interval when window is in or near the target position
      if (
        Math.abs(bounds.x - x) < step + variation &&
        Math.abs(bounds.y - y) < step + variation
      ) {
        this.isMoving = false
        this.setWindowBounds(bounds)
        clearInterval(intervalo)
      }
    }, time)
  }

  moveWindowToScreenEdge(edge = this.currentScreenEdge) {
    if (this.isMoving) return

    this.isMoving = true
    this.currentScreenEdge = edge

    const { x, y } = this.window.getBounds()
    const display = _screen.getDisplayNearestPoint({ x, y })

    const bounds = { x: display.bounds.x, y: display.bounds.y }
    const { width, height } = this.getScreenSizeInPixels()

    const SCREEN_PADDING = 24

    switch (edge) {
      case 'top-left':
        bounds.x += SCREEN_PADDING
        bounds.y += SCREEN_PADDING
        break

      case 'bottom-left':
        bounds.x += SCREEN_PADDING
        bounds.y += display.size.height - height - SCREEN_PADDING
        break

      case 'top-right':
        bounds.x += display.size.width - width - SCREEN_PADDING
        bounds.y += SCREEN_PADDING
        break

      case 'bottom-right':
        bounds.x += display.size.width - width - SCREEN_PADDING
        bounds.y += display.size.height - height - SCREEN_PADDING
        break
    }

    this.setWindowBounds(bounds)
    this.isMoving = false
  }

  toggleWindowVisibility() {
    this.isScreenVisible ? this.window.hide() : this.window.show()
    this.isScreenVisible = !this.isScreenVisible
  }

  toggleWindowSize() {
    const size = this.currentScreenSize === 'initial' ? 'large' : 'initial'
    this.setWindowSize(size)
  }
}
