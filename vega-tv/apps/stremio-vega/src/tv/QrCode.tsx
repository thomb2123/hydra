// Renders a QR code with plain Views (no WebView, no images needed).
import React, {useMemo} from 'react';
import {View} from 'react-native';
import qrcode from 'qrcode-generator';

export const QrCode = ({text, size = 300}: {text: string; size?: number}) => {
  const matrix = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const rows: boolean[][] = [];
    for (let r = 0; r < count; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < count; c++) {
        row.push(qr.isDark(r, c));
      }
      rows.push(row);
    }
    return rows;
  }, [text]);
  const quiet = 4;
  const cell = Math.floor(size / (matrix.length + quiet * 2));
  return (
    <View style={{backgroundColor: 'white', padding: cell * quiet, borderRadius: 12}}>
      {matrix.map((row, r) => (
        <View key={r} style={{flexDirection: 'row'}}>
          {row.map((dark, c) => (
            <View key={c} style={{width: cell, height: cell, backgroundColor: dark ? 'black' : 'white'}} />
          ))}
        </View>
      ))}
    </View>
  );
};
