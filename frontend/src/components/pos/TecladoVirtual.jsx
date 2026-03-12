import React, { useState } from 'react'

const LAYOUTS = {
  lower: [
    ['1','2','3','4','5','6','7','8','9','0'],
    ['q','w','e','r','t','y','u','i','o','p'],
    ['a','s','d','f','g','h','j','k','l'],
    ['⇧','z','x','c','v','b','n','m','⌫'],
    ['espacio'],
  ],
  upper: [
    ['1','2','3','4','5','6','7','8','9','0'],
    ['Q','W','E','R','T','Y','U','I','O','P'],
    ['A','S','D','F','G','H','J','K','L'],
    ['⇧','Z','X','C','V','B','N','M','⌫'],
    ['espacio'],
  ],
}

export default function TecladoVirtual({ valor, onChange, onEnter }) {
  const [mayus, setMayus] = useState(false)
  const layout = mayus ? LAYOUTS.upper : LAYOUTS.lower

  const handleKey = (key) => {
    if (key === '⇧') {
      setMayus(m => !m)
    } else if (key === '⌫') {
      onChange(valor.slice(0, -1))
    } else if (key === 'espacio') {
      onChange(valor + ' ')
    } else {
      onChange(valor + key)
    }
  }

  return (
    <div className="bg-gray-100 rounded-xl p-2 shadow-inner mt-2 select-none">
      {layout.map((row, ri) => (
        <div key={ri} className="flex justify-center gap-1 mb-1">
          {row.map((key) => {
            const isSpecial = key === '⇧' || key === '⌫'
            const isSpace = key === 'espacio'
            return (
              <button
                key={key}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleKey(key)}
                className={`
                  rounded-lg font-mono text-sm font-semibold
                  active:scale-95 transition-transform
                  ${isSpace
                    ? 'flex-1 bg-white border border-gray-300 py-3 text-gray-400'
                    : isSpecial
                      ? 'px-3 py-2.5 bg-gray-300 text-gray-700 min-w-[40px]'
                      : 'px-2.5 py-2.5 bg-white border border-gray-300 text-gray-800 min-w-[32px] hover:bg-gray-50'
                  }
                  ${key === '⇧' && mayus ? 'bg-violet-200 border-violet-400' : ''}
                `}
              >
                {isSpace ? 'ESPACIO' : key}
              </button>
            )
          })}
        </div>
      ))}
      {onEnter && (
        <div className="flex justify-center mt-1">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onEnter}
            className="px-6 py-2.5 bg-violet-600 text-white rounded-lg font-semibold text-sm active:scale-95 transition-transform"
          >
            BUSCAR
          </button>
        </div>
      )}
    </div>
  )
}
