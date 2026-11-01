// 編輯器預設載入的 main.c
export const DEFAULT_CODE = `#include "main.h"
#include <stdio.h>

#define SENSOR_ADDR  (0x76 << 1)   // 感測器 7 位元位址 0x76

int main(void)
{
  HAL_Init();
  SystemClock_Config();            // SYSCLK 480 MHz
  MX_GPIO_Init();
  MX_I2C1_Init();                  // PB8 = SCL, PB9 = SDA
  MX_USART3_UART_Init();           // printf → ST-LINK 虛擬 COM

  uint8_t buf[2];
  printf("STM32H743 boot, SYSCLK = %lu MHz\\r\\n", 480UL);

  if (HAL_I2C_Mem_Read(&hi2c1, SENSOR_ADDR, 0xD0, I2C_MEMADD_SIZE_8BIT, buf, 1, 100) == HAL_OK) {
    printf("Sensor found, ID = 0x%02X\\r\\n", buf[0]);
  } else {
    printf("Sensor not found on I2C1\\r\\n");
  }

  uint32_t lastBlink = 0, lastRead = 0;
  while (1)
  {
    uint32_t now = HAL_GetTick();

    if (now - lastBlink >= 500) {          // 每 500 ms 閃一次
      lastBlink = now;
      HAL_GPIO_TogglePin(GPIOA, GPIO_PIN_5);   // 外接 LED
      HAL_GPIO_TogglePin(GPIOB, GPIO_PIN_0);   // LD1 綠燈
    }

    // 外接按鈕 PA0 → LD3 紅燈；板載 B1 (PC13) → LD2 黃燈
    HAL_GPIO_WritePin(GPIOB, GPIO_PIN_14, HAL_GPIO_ReadPin(GPIOA, GPIO_PIN_0));
    HAL_GPIO_WritePin(GPIOE, GPIO_PIN_1, HAL_GPIO_ReadPin(GPIOC, GPIO_PIN_13));

    if (now - lastRead >= 1000) {          // 每秒讀一次溫度
      lastRead = now;
      if (HAL_I2C_Mem_Read(&hi2c1, SENSOR_ADDR, 0xFA, I2C_MEMADD_SIZE_8BIT, buf, 2, 100) == HAL_OK) {
        float t = ((buf[0] << 8) | buf[1]) / 100.0f;
        printf("T = %.2f C\\r\\n", t);
      } else {
        printf("I2C read failed\\r\\n");
      }
    }
    HAL_Delay(10);
  }
}
`;
