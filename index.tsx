
import React, { useState, useMemo, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";

// --- Sound Effects Manager ---

let audioCtx: AudioContext | null = null;
let lastTickTime = 0;

const getAudioContext = (): AudioContext | null => {
    if (typeof window === 'undefined') return null;
    if (!audioCtx) {
        try {
            audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        } catch(e) {
            console.error("Web Audio API is not supported in this browser.");
            return null;
        }
    }
    return audioCtx;
};

const playSound = (type: 'tick' | 'select' | 'goal' | 'click' | 'reveal') => {
    const ctx = getAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
        ctx.resume();
    }

    try {
        const now = ctx.currentTime;
        const gainNode = ctx.createGain();
        gainNode.connect(ctx.destination);
        let oscillator: OscillatorNode;

        switch(type) {
            case 'tick':
                const nowMs = Date.now();
                if (nowMs - lastTickTime < 50) return; // Debounce for 50ms
                lastTickTime = nowMs;

                oscillator = ctx.createOscillator();
                oscillator.type = 'sine';
                oscillator.frequency.setValueAtTime(800, now);
                oscillator.frequency.linearRampToValueAtTime(1200, now + 0.05);
                gainNode.gain.setValueAtTime(0.08, now);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
                oscillator.connect(gainNode);
                oscillator.start(now);
                oscillator.stop(now + 0.05);
                break;

            case 'select':
                oscillator = ctx.createOscillator();
                oscillator.type = 'square';
                oscillator.frequency.setValueAtTime(200, now);
                gainNode.gain.setValueAtTime(0.1, now);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
                oscillator.connect(gainNode);
                oscillator.start(now);
                oscillator.stop(now + 0.1);
                break;

            case 'goal':
                const osc1 = ctx.createOscillator();
                const osc2 = ctx.createOscillator();
                osc1.type = 'sine';
                osc2.type = 'sine';
                osc1.frequency.setValueAtTime(523.25, now); // C5
                osc2.frequency.setValueAtTime(783.99, now + 0.15); // G5
                
                gainNode.gain.setValueAtTime(0.15, now);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);

                osc1.connect(gainNode);
                osc2.connect(gainNode);

                osc1.start(now);
                osc1.stop(now + 0.15);
                osc2.start(now + 0.15);
                osc2.stop(now + 0.4);
                break;

            case 'click':
                oscillator = ctx.createOscillator();
                oscillator.type = 'triangle';
                oscillator.frequency.setValueAtTime(440, now);
                gainNode.gain.setValueAtTime(0.08, now);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
                oscillator.connect(gainNode);
                oscillator.start(now);
                oscillator.stop(now + 0.08);
                break;

            case 'reveal':
                oscillator = ctx.createOscillator();
                oscillator.type = 'sine';
                oscillator.frequency.setValueAtTime(400, now);
                oscillator.frequency.exponentialRampToValueAtTime(1000, now + 0.3);
                gainNode.gain.setValueAtTime(0.1, now);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
                oscillator.connect(gainNode);
                oscillator.start(now);
                oscillator.stop(now + 0.3);
                break;
        }

    } catch (e) {
        console.error("Could not play sound:", e);
    }
};

// --- Data & Configuration ---
const LABOR_COST_PER_HOUR = 20;
const MAX_LABOUR = 10;

const PRODUCTION_SCHEDULES = [
  {
    name: 'Standard Oven',
    description: 'A reliable, small pizza oven. Good for starting out.',
    fixedCost: 100,
    icon: '🔥',
    // Production[i] is the total pizzas produced by i chefs.
    production: [0, 10, 25, 45, 60, 70, 75, 77, 78, 78, 75],
  },
  {
    name: 'Conveyor Belt Oven',
    description: 'A larger, more efficient oven that streamlines the cooking process.',
    fixedCost: 200,
    icon: '⏩',
    production: [0, 20, 50, 90, 140, 180, 210, 230, 240, 245, 248],
  },
  {
    name: 'Industrial Kitchen',
    description: 'A fully-equipped industrial kitchen for maximum output.',
    fixedCost: 400,
    icon: '🏭',
    production: [0, 30, 70, 120, 180, 250, 330, 420, 500, 560, 600],
  },
];

// --- Helper Components ---
interface ChartPoint {
    x: number;
    y: number;
}
interface ChartDataset {
    label: string;
    data: ChartPoint[];
    color: string;
}
interface ChartProps {
    datasets: ChartDataset[];
    title: string;
    children?: React.ReactNode;
}

const Chart = ({ datasets, title, children }: ChartProps) => {
  const [tooltip, setTooltip] = useState<{ x: number, points: any[], svgX: number, svgY: number } | null>(null);
  const svgWidth = 320;
  const svgHeight = 200;
  const margin = { top: 20, right: 20, bottom: 30, left: 40 };
  const width = svgWidth - margin.left - margin.right;
  const height = svgHeight - margin.top - margin.bottom;

  const allPoints = datasets.flatMap(ds => ds.data);
  const yValues = allPoints.map(d => Number(d.y)).filter(isFinite);
  const xValues = allPoints.map(d => d.x);

  const maxY = Math.max(0, ...yValues);
  const minY = Math.min(0, ...yValues);
  const maxX = Math.max(...xValues);
  const minX = Math.min(...xValues);

  const xScale = (x: number) => {
    if (maxX === minX) return width / 2;
    return ((x - minX) / (maxX - minX)) * width;
  };
  
  const yScale = (y: number) => {
    if (maxY === minY) return height / 2;
    return height - ((y - minY) / (maxY - minY)) * height;
  };

  const createSmoothPath = (points: ChartPoint[]) => {
      if (points.length < 2) return '';
      const scaledPoints = points.map(p => ({ x: xScale(p.x), y: yScale(p.y) }));

      let path = `M ${scaledPoints[0].x},${scaledPoints[0].y}`;
      if (scaledPoints.length === 2) {
          path += ` L ${scaledPoints[1].x},${scaledPoints[1].y}`;
          return path;
      }

      for (let i = 0; i < scaledPoints.length - 1; i++) {
          const p0 = i > 0 ? scaledPoints[i - 1] : scaledPoints[i];
          const p1 = scaledPoints[i];
          const p2 = scaledPoints[i + 1];
          const p3 = i < scaledPoints.length - 2 ? scaledPoints[i + 2] : p2;

          const tension = 0.5;
          const t1x = (p2.x - p0.x) * tension;
          const t1y = (p2.y - p0.y) * tension;
          const t2x = (p3.x - p1.x) * tension;
          const t2y = (p3.y - p1.y) * tension;

          const cp1 = { x: p1.x + t1x, y: p1.y + t1y };
          const cp2 = { x: p2.x - t2x, y: p2.y - t2y };

          path += ` C ${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${p2.x},${p2.y}`;
      }
      return path;
  };

  const handleMouseOver = (xValue: number) => {
    const pointsForX = datasets.map(ds => {
      const point = ds.data.find(p => p.x === xValue);
      return point ? { ...point, label: ds.label, color: ds.color, unit: '€'} : null;
    }).filter(Boolean);

    if (pointsForX.length > 0) {
      const yPositions = pointsForX.map(p => yScale(p.y));
      const avgY = yPositions.reduce((sum, y) => sum + y, 0) / yPositions.length;
      setTooltip({
        x: xValue,
        points: pointsForX,
        svgX: xScale(xValue),
        svgY: avgY,
      });
    }
  };

  const handleMouseLeave = () => {
    setTooltip(null);
  };

  const uniqueXValues = [...new Set(allPoints.map(p => p.x))].sort((a,b) => Number(a) - Number(b));
  const columnWidth = uniqueXValues.length > 1 ? xScale(uniqueXValues[1]) - xScale(uniqueXValues[0]) : width;

  return (
    <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-lg flex flex-col">
      <div className="flex justify-between items-center mb-1">
        <h3 className="text-center font-semibold text-sm flex-grow">{title}</h3>
        {children}
      </div>
      {datasets.length > 1 && (
        <div className="flex justify-center items-center gap-4 text-xs mb-2">
            {datasets.map(ds => (
                <div key={ds.label} className="flex items-center gap-1.5">
                    <span className={`w-3 h-3 rounded-full ${ds.color.replace('text-', 'bg-')}`}></span>
                    <span>{ds.label}</span>
                </div>
            ))}
        </div>
      )}
      <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto" aria-label={title}>
         <defs>
            <filter id="tooltip-shadow" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx="1" dy="1" stdDeviation="2" floodColor="#000000" floodOpacity="0.2"/>
            </filter>
        </defs>
        <g transform={`translate(${margin.left}, ${margin.top})`} onMouseLeave={handleMouseLeave}>
          {/* Y Axis */}
          <line x1="0" y1="0" x2="0" y2={height} className="stroke-current text-slate-400 dark:text-slate-600" />
          <text x="-10" y={yScale(maxY)} dy=".32em" textAnchor="end" className="text-xs fill-current">{Math.ceil(maxY)}</text>
          <text x="-10" y={yScale(minY)} dy=".32em" textAnchor="end" className="text-xs fill-current">{Math.floor(minY)}</text>
          
          {/* X Axis */}
          <line x1="0" y1={height} x2={width} y2={height} className="stroke-current text-slate-400 dark:text-slate-600" />
           {uniqueXValues.map(x => (
             <text key={`label-${x}`} x={xScale(x)} y={height + 15} textAnchor="middle" className="text-xs fill-current">{x}</text>
           ))}

          {/* Zero Line */}
          {minY < 0 && (
            <line x1="0" y1={yScale(0)} x2={width} y2={yScale(0)} className="stroke-current text-slate-400 dark:text-slate-600" strokeDasharray="2" />
          )}

          {/* Path Segments */}
          {datasets.map(ds => {
            const isMarginalProduct = ds.label === 'Marginal Product of Labour';
            const isTotalProfit = ds.label === 'Total Profit';

            if (isMarginalProduct || isTotalProfit) {
              const positiveData = ds.data.filter(d => d.y >= 0);
              const negativeData = ds.data.filter(d => d.y <= 0);
              // Find the intersection point to split the path
              let intersectionPoint = null;
              for(let i=0; i < ds.data.length - 1; i++) {
                if ((ds.data[i].y >= 0 && ds.data[i+1].y < 0) || (ds.data[i].y <= 0 && ds.data[i+1].y > 0)) {
                   const p1 = ds.data[i];
                   const p2 = ds.data[i+1];
                   if (p2.y - p1.y !== 0) {
                       const x = p1.x - p1.y * (p2.x - p1.x) / (p2.y - p1.y); // Interpolate
                       intersectionPoint = { x, y: 0 };
                       if(p1.y >= 0) {
                           positiveData.push(intersectionPoint);
                           negativeData.unshift(intersectionPoint);
                       } else {
                           negativeData.push(intersectionPoint);
                           positiveData.unshift(intersectionPoint);
                       }
                   }
                   break;
                }
              }

              return (
                <React.Fragment key={ds.label}>
                  <path d={createSmoothPath(positiveData)} className={`stroke-2 fill-none ${isTotalProfit ? 'text-green-500' : ds.color}`} />
                  <path d={createSmoothPath(negativeData)} className={`stroke-2 fill-none text-red-500`} />
                </React.Fragment>
              )
            }
            return <path key={ds.label} d={createSmoothPath(ds.data)} className={`stroke-2 fill-none ${ds.color}`} />
          })}

          {/* Invisible hover targets for better UX */}
          {uniqueXValues.map(x => (
            <rect
              key={`hover-col-${x}`}
              x={xScale(x) - columnWidth / 2}
              y="0"
              width={columnWidth}
              height={height}
              fill="transparent"
              onMouseOver={() => handleMouseOver(x)}
            />
          ))}

          {/* Data Points */}
          {datasets.flatMap(ds => ds.data.map(d => {
            const isSpecialCase = ds.label === 'Marginal Product of Labour' || ds.label === 'Total Profit';
            const pointColor = isSpecialCase && d.y < 0 ? 'text-red-500' : ds.color;
            return (
              <circle key={`${ds.label}-${d.x}`} cx={xScale(d.x)} cy={yScale(d.y)} r="3" className={`fill-current ${pointColor}`} style={{pointerEvents: 'none'}} />
            );
          }))}
          
           {/* Tooltip */}
          {tooltip && (
            <g transform={`translate(${tooltip.svgX}, ${tooltip.svgY})`} style={{ pointerEvents: 'none' }}>
               {/* Vertical Crosshair Line */}
              <line y1={-tooltip.svgY} y2={height - tooltip.svgY} className="stroke-slate-400 dark:stroke-slate-600" strokeDasharray="3,3" />

              <g transform={`translate(${tooltip.svgX > width / 2 ? -130 : 15}, -${(tooltip.points.length * 15) + 10})`}>
                <rect 
                  x="0" y="-22" 
                  width="115" height={20 + (tooltip.points.length * 18)} 
                  rx="4" 
                  className="fill-white dark:fill-slate-900"
                  filter="url(#tooltip-shadow)"
                />
                <text x="8" y="0" className="text-xs fill-slate-700 dark:fill-slate-200 font-semibold">
                  <tspan dy="-1.1em" x="8">Chefs: {tooltip.x}</tspan>
                   {tooltip.points.map((p, i) => (
                      <tspan key={p.label} dy="1.4em" x="8">
                        <tspan className={`fill-current ${p.y < 0 && (p.label === 'Total Profit' || p.label === 'Marginal Product of Labour') ? 'text-red-500' : p.color}`}>{`● ${p.label.split(' ')[0]}: ${p.unit}${isFinite(Number(p.y)) ? Number(p.y).toFixed(2) : 'N/A'}`}</tspan>
                      </tspan>
                   ))}
                </text>
              </g>
              {tooltip.points.map(p => (
                <circle key={`tooltip-circle-${p.label}`} cx="0" cy={yScale(p.y) - tooltip.svgY} r="5" className={`stroke-2 ${p.y < 0 && (p.label === 'Total Profit' || p.label === 'Marginal Product of Labour') ? 'text-red-500' : p.color} fill-white dark:fill-slate-900`} />
              ))}
            </g>
          )}
        </g>
      </svg>
    </div>
  );
};

const BarChart = ({ datasets, title }: ChartProps) => {
  const [tooltip, setTooltip] = useState<{ x: number, points: any[], svgX: number, svgY: number } | null>(null);
  const svgWidth = 320;
  const svgHeight = 200;
  const margin = { top: 20, right: 20, bottom: 30, left: 40 };
  const width = svgWidth - margin.left - margin.right;
  const height = svgHeight - margin.top - margin.bottom;

  const allPoints = datasets.flatMap(ds => ds.data);
  const yValues = allPoints.map(d => Number(d.y)).filter(isFinite);
  const xValues = [...new Set(allPoints.map(p => p.x))].sort((a,b) => Number(a) - Number(b));

  const maxY = Math.max(0, ...yValues);
  const minY = Math.min(0, ...yValues);
  
  const yScale = (y: number) => {
    if (maxY === minY) return height / 2;
    return height - ((y - minY) / (maxY - minY)) * height;
  };

  const bandWidth = xValues.length > 0 ? width / xValues.length : width;
  const barPadding = 0.2; 
  const groupWidth = bandWidth * (1 - barPadding);
  const barWidth = groupWidth / datasets.length;

  const getXPosition = (x: number) => {
    const index = xValues.indexOf(x);
    if (index === -1) return 0;
    return index * bandWidth;
  };

  const handleMouseOver = (xValue: number) => {
    const pointsForX = datasets.map(ds => {
      const point = ds.data.find(p => p.x === xValue);
      return point ? { ...point, label: ds.label, color: ds.color } : null;
    }).filter(Boolean);

    if (pointsForX.length > 0) {
      const yPositions = pointsForX.map(p => yScale(p.y));
      const avgY = yPositions.reduce((sum, y) => sum + y, 0) / yPositions.length;
      setTooltip({
        x: xValue,
        points: pointsForX,
        svgX: getXPosition(xValue) + bandWidth / 2,
        svgY: avgY,
      });
    }
  };

  const handleMouseLeave = () => {
    setTooltip(null);
  };

  return (
    <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-lg">
      <h3 className="text-center font-semibold text-sm mb-1">{title}</h3>
      {datasets.length > 1 && (
        <div className="flex justify-center items-center gap-4 text-xs mb-2">
            {datasets.map(ds => (
                <div key={ds.label} className="flex items-center gap-1.5">
                    <span className={`w-3 h-3 rounded-sm ${ds.color.replace('text-', 'bg-')}`}></span>
                    <span>{ds.label}</span>
                </div>
            ))}
        </div>
      )}
      <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto" aria-label={title}>
         <defs>
            <filter id="tooltip-shadow-bar" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx="1" dy="1" stdDeviation="2" floodColor="#000000" floodOpacity="0.2"/>
            </filter>
        </defs>
        <g transform={`translate(${margin.left}, ${margin.top})`} onMouseLeave={handleMouseLeave}>
          {/* Y Axis */}
          <line x1="0" y1="0" x2="0" y2={height} className="stroke-current text-slate-400 dark:text-slate-600" />
          <text x="-10" y={yScale(maxY)} dy=".32em" textAnchor="end" className="text-xs fill-current">{Math.ceil(maxY)}</text>
          <text x="-10" y={yScale(minY)} dy=".32em" textAnchor="end" className="text-xs fill-current">{Math.floor(minY)}</text>
          
          {/* X Axis */}
          <line x1="0" y1={height} x2={width} y2={height} className="stroke-current text-slate-400 dark:text-slate-600" />
           {xValues.map(x => (
             <text key={`label-${x}`} x={getXPosition(x) + bandWidth / 2} y={height + 15} textAnchor="middle" className="text-xs fill-current">{x}</text>
           ))}

          {/* Zero Line */}
          {minY < 0 && (
            <line x1="0" y1={yScale(0)} x2={width} y2={yScale(0)} className="stroke-current text-slate-400 dark:text-slate-600" />
          )}
        
          {/* Bars */}
          {xValues.map(x => {
            const groupX = getXPosition(x) + (bandWidth * barPadding) / 2;
            return (
              <g key={`group-${x}`} transform={`translate(${groupX}, 0)`}>
                {datasets.map((ds, i) => {
                  const point = ds.data.find(d => d.x === x);
                  if (!point) return null;
                  
                  const isMarginalProduct = ds.label === 'Marginal Product of Labour';
                  const barY = point.y >= 0 ? yScale(point.y) : yScale(0);
                  const barHeight = Math.abs(yScale(point.y) - yScale(0));
                  const colorClass = isMarginalProduct && point.y < 0 ? 'text-red-500' : ds.color;

                  return (
                    <rect
                      key={`${ds.label}-${x}`}
                      x={i * barWidth}
                      y={barY}
                      width={barWidth}
                      height={barHeight}
                      className={`fill-current ${colorClass}`}
                    />
                  );
                })}
              </g>
            )
          })}

          {/* Invisible hover targets for better UX */}
          {xValues.map(x => (
            <rect
              key={`hover-col-${x}`}
              x={getXPosition(x)}
              y="0"
              width={bandWidth}
              height={height}
              fill="transparent"
              onMouseOver={() => handleMouseOver(x)}
            />
          ))}
          
           {/* Tooltip */}
          {tooltip && (
            <g transform={`translate(${tooltip.svgX}, ${tooltip.svgY})`} style={{ pointerEvents: 'none' }}>
              <g transform={`translate(${tooltip.svgX > width / 2 ? -130 : 15}, -${(tooltip.points.length * 15) + 10})`}>
                <rect 
                  x="0" y="-22" 
                  width="115" height={20 + (tooltip.points.length * 18)} 
                  rx="4" 
                  className="fill-white dark:fill-slate-900"
                  filter="url(#tooltip-shadow-bar)"
                />
                <text x="8" y="0" className="text-xs fill-slate-700 dark:fill-slate-200 font-semibold">
                  <tspan dy="-1.1em" x="8">Chefs: {tooltip.x}</tspan>
                   {tooltip.points.map((p, i) => (
                      <tspan key={p.label} dy="1.4em" x="8">
                        <tspan className={`fill-current ${p.y < 0 && (p.label === 'Marginal Product of Labour') ? 'text-red-500' : p.color}`}>{`● ${p.label.split(' ')[0]}: ${isFinite(Number(p.y)) ? Number(p.y).toFixed(0) : 'N/A'}`}</tspan>
                      </tspan>
                   ))}
                </text>
              </g>
            </g>
          )}
        </g>
      </svg>
    </div>
  );
};

const AnimatedNumber = ({ value, toFixed = 0 }: { value: number, toFixed?: number }) => {
    const [displayValue, setDisplayValue] = useState(value);
    const frameRef = useRef<number | null>(null);

    useEffect(() => {
        const startValue = displayValue;
        const endValue = value;
        if (startValue === endValue) return;

        let startTime: number | null = null;
        const duration = 500; // Animation duration in ms

        const animate = (timestamp: number) => {
            if (!startTime) startTime = timestamp;
            const progress = timestamp - startTime;
            const percentage = Math.min(progress / duration, 1);
            
            const easedPercentage = 1 - Math.pow(1 - percentage, 3);
            
            const currentValue = startValue + (endValue - startValue) * easedPercentage;
            
            setDisplayValue(currentValue);

            if (progress < duration) {
                frameRef.current = requestAnimationFrame(animate);
            } else {
                setDisplayValue(endValue);
            }
        };

        if (frameRef.current) cancelAnimationFrame(frameRef.current);
        frameRef.current = requestAnimationFrame(animate);

        return () => {
            if (frameRef.current) cancelAnimationFrame(frameRef.current);
        };
    }, [value]);

    return <>{displayValue.toLocaleString(undefined, { minimumFractionDigits: toFixed, maximumFractionDigits: toFixed })}</>;
};

const App = () => {
  const [labour, setLabour] = useState(3);
  const [price, setPrice] = useState(15);
  const [scheduleIndex, setScheduleIndex] = useState(0);
  const [runTutorial, setRunTutorial] = useState(false); // This would be used by a Tutorial component
  const [analysis, setAnalysis] = useState({ text: '', isLoading: false });
  const [savedScenarios, setSavedScenarios] = useState<any[]>([]);
  const goalAchievedRef = useRef(false);

  const productionSchedule = PRODUCTION_SCHEDULES[scheduleIndex];

  const economicData = useMemo(() => {
    const dataPoints = Array.from({ length: MAX_LABOUR + 1 }, (_, i) => {
      const numLabour = i;
      const totalProduction = productionSchedule.production[numLabour] || 0;
      const marginalProduct = numLabour > 0 ? (productionSchedule.production[numLabour] - productionSchedule.production[numLabour - 1]) : productionSchedule.production[numLabour];
      const totalRevenue = totalProduction * price;
      const variableCost = numLabour * LABOR_COST_PER_HOUR * 8; // 8-hour shift
      const fixedCost = productionSchedule.fixedCost;
      const totalCost = fixedCost + variableCost;
      const totalProfit = totalRevenue - totalCost;
      const marginalCost = marginalProduct > 0 ? (variableCost - ((numLabour - 1) * LABOR_COST_PER_HOUR * 8)) / marginalProduct : Infinity;
      const averageTotalCost = totalProduction > 0 ? totalCost / totalProduction : Infinity;

      return {
        labour: numLabour,
        totalProduction,
        marginalProduct,
        totalRevenue,
        variableCost,
        fixedCost,
        totalCost,
        totalProfit,
        marginalCost,
        averageTotalCost,
      };
    });
    return dataPoints;
  }, [price, productionSchedule]);

  const currentData = economicData[labour];
  const maxProfitData = economicData.reduce((max, current) => (current.totalProfit > max.totalProfit ? current : max), economicData[0]);

  const minAtcData = useMemo(() => {
      const validData = economicData.filter(d => isFinite(d.averageTotalCost) && d.labour > 0);
      if (validData.length === 0) return economicData[0];
      return validData.reduce((min, current) => (current.averageTotalCost < min.averageTotalCost ? current : min), validData[0]);
  }, [economicData]);

  useEffect(() => {
    const isProfitCloseEnough = Math.abs(currentData.totalProfit - maxProfitData.totalProfit) < 0.01;
    const isGoalAchieved = currentData.totalProfit > 0 && isProfitCloseEnough;

    if (isGoalAchieved && !goalAchievedRef.current) {
        playSound('goal');
        goalAchievedRef.current = true;
    } else if (!isGoalAchieved) {
        goalAchievedRef.current = false;
    }
  }, [currentData.totalProfit, maxProfitData.totalProfit]);

  const handleLabourChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    playSound('tick');
    setLabour(Number(e.target.value));
  };

  const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    playSound('tick');
    setPrice(Number(e.target.value));
  };
  
  const handleScheduleChange = (index: number) => {
    playSound('select');
    setScheduleIndex(index);
    setAnalysis({ text: '', isLoading: false }); // Clear analysis on schedule change
  };

  const handleAnalyzeCosts = async () => {
    setAnalysis({ text: '', isLoading: true });
    playSound('click');

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
      const dataForPrompt = economicData
        .filter(d => d.labour > 0)
        .map(d => `Labour: ${d.labour}, Total Production: ${d.totalProduction}, ATC: ${isFinite(d.averageTotalCost) ? d.averageTotalCost.toFixed(2) : 'N/A'}, MC: ${isFinite(d.marginalCost) ? d.marginalCost.toFixed(2) : 'N/A'}`)
        .join('\n');

      const prompt = `As an economist, provide a concise cost analysis for Boom and Crust Pizza based on the following data for their "${productionSchedule.name}" setup (Fixed Cost: €${productionSchedule.fixedCost}).

Data:
${dataForPrompt}

Explain the U-shape of the Average Total Cost (ATC) curve using precise economic principles.

1.  **Falling ATC:** Explain how spreading fixed costs over more units and the division of labour initially reduce the average cost per pizza.
2.  **Rising ATC:** Explain how the law of diminishing marginal returns eventually causes ATC to rise in the short run due to the fixed capital constraint (one oven).
3.  **Long-Run:** Briefly state that the long-run ATC curve is U-shaped due to economies and diseconomies of scale.

The analysis must be brief, professional, and direct. Avoid conversational or effusive language.`;

      const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt
      });
      
      setAnalysis({ text: response.text, isLoading: false });
      playSound('reveal');
    } catch (error) {
      console.error("Error generating analysis:", error);
      setAnalysis({ text: 'Sorry, an error occurred while analyzing the data.', isLoading: false });
    }
  };
  
  const handleOptimizeProduction = () => {
      playSound('click');
      setLabour(minAtcData.labour);
  };
  
  const handleSaveScenario = () => {
    playSound('goal');
    const newScenario = {
      name: productionSchedule.name,
      icon: productionSchedule.icon,
      maxProfit: maxProfitData.totalProfit,
      optimalLabour: maxProfitData.labour,
      priceAtSave: price,
      mcAtMaxProfit: maxProfitData.marginalCost,
      atcAtMaxProfit: maxProfitData.averageTotalCost,
    };

    setSavedScenarios(prev => {
      const existingIndex = prev.findIndex(s => s.name === newScenario.name);
      if (existingIndex > -1) {
        const updated = [...prev];
        updated[existingIndex] = newScenario;
        return updated;
      }
      return [...prev, newScenario];
    });
  };

  const handleClearScenarios = () => {
    playSound('click');
    setSavedScenarios([]);
  };
  
  // Chart Datasets
  const productionChartData = [{
      label: "Total Production",
      data: economicData.map(d => ({ x: d.labour, y: d.totalProduction })),
      color: "text-blue-500",
  }, {
      label: "Marginal Product of Labour",
      data: economicData.map(d => ({ x: d.labour, y: d.marginalProduct })),
      color: "text-purple-500",
  }];

  const costChartData = [{
      label: "Marginal Cost",
      data: economicData.map(d => ({ x: d.labour, y: d.marginalCost })).filter(d => isFinite(d.y)),
      color: "text-cyan-500",
  }, {
      label: "Average Total Cost",
      data: economicData.map(d => ({ x: d.labour, y: d.averageTotalCost })).filter(d => isFinite(d.y)),
      color: "text-amber-500",
  }];

  const profitChartData = [{
      label: "Total Profit",
      data: economicData.map(d => ({ x: d.labour, y: d.totalProfit })),
      color: "text-green-500",
  }];
  
  const metrics = [
    { label: 'Total Production', value: currentData.totalProduction, unit: 'pizzas' },
    { label: 'Total Revenue', value: currentData.totalRevenue, unit: '€' },
    { label: 'Total Cost', value: currentData.totalCost, unit: '€' },
    { label: 'Total Profit', value: currentData.totalProfit, unit: '€', highlight: true },
  ];

  const TUTORIAL_STEPS = [
    { element: '#capital-control', title: 'Step 1: Choose Your Capital', content: 'Capital represents your equipment. A bigger kitchen costs more but allows your chefs to produce more pizza. Start with the Standard Oven.' },
    { element: '#labour-control', title: 'Step 2: Adjust Your Labour', content: 'Labour is the number of chefs you hire. Notice how adding chefs initially increases production a lot, but then the benefit of each new chef starts to decrease. This is "diminishing marginal returns"!' },
    { element: '#price-control', title: 'Step 3: Set the Price', content: 'The price per pizza affects your total revenue and profit. Play around to see how it interacts with your production levels.' },
    { element: '#metrics', title: 'Step 4: Analyse Your Metrics', content: 'These cards show your key performance indicators. Keep an eye on them as you make changes.' },
    { element: '#charts', title: 'Step 5: Visualise the Data', content: 'These charts help you understand the relationships between labour, production, costs, and profit. The cost chart shows Marginal and Average Total Cost. Profit is maximised where marginal cost equals marginal revenue (the price)!' },
    { element: '#optimization-goal', title: 'Step 6: The Goal', content: "Your goal is to maximize profit. This card shows the highest possible profit with your current setup. You can also click 'Optimize for Cost' to find the most efficient production level (lowest cost per pizza), or save your results to compare different capital investments." },
  ];
  
  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white dark:bg-slate-800 shadow-md p-4 sticky top-0 z-10">
        <div className="container mx-auto flex justify-between items-center">
            <h1 className="text-xl md:text-2xl font-bold text-orange-500">🍕 Boom and Crust Pizzeria</h1>
            <button onClick={() => setRunTutorial(true)} className="text-sm bg-slate-200 dark:bg-slate-700 font-semibold px-3 py-1.5 rounded-md hover:bg-slate-300 dark:hover:bg-slate-600">
                Help
            </button>
        </div>
      </header>
      
      <main className="container mx-auto p-4 md:p-6 space-y-6 flex-grow">
        {/* Metrics Section */}
        <div id="metrics" className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {metrics.map(metric => (
            <div key={metric.label} className={`bg-white dark:bg-slate-800 p-4 rounded-xl shadow-lg text-center ${metric.highlight && Math.abs(currentData.totalProfit - maxProfitData.totalProfit) < 0.01 && currentData.totalProfit > 0 ? 'goal-achieved-animate' : ''}`}>
              <p className="text-sm text-slate-500 dark:text-slate-400">{metric.label}</p>
              <p className={`text-2xl font-bold ${metric.highlight ? (currentData.totalProfit >= 0 ? 'text-green-500' : 'text-red-500') : ''}`}>
                {metric.unit === '€' && '€'}<AnimatedNumber value={metric.value} toFixed={metric.unit === '€' ? 2 : 0} /> {metric.unit !== '€' && metric.unit}
              </p>
            </div>
          ))}
        </div>

        {/* Controls Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div id="capital-control" className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-lg">
                <h2 className="text-lg font-bold mb-2">Capital Investment</h2>
                <div className="flex flex-col sm:flex-row gap-2">
                    {PRODUCTION_SCHEDULES.map((schedule, index) => (
                        <button key={schedule.name} onClick={() => handleScheduleChange(index)} className={`flex-1 p-3 rounded-lg text-center border-2 ${scheduleIndex === index ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}`}>
                            <span className="text-2xl">{schedule.icon}</span>
                            <p className="font-semibold">{schedule.name}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Fixed Cost: €{schedule.fixedCost}</p>
                        </button>
                    ))}
                </div>
            </div>
            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-lg space-y-4">
                 <div id="labour-control">
                    <label htmlFor="labour-slider" className="flex justify-between font-bold"><span>Labour (Chefs)</span><span>{labour}</span></label>
                    <input id="labour-slider" type="range" min="0" max={MAX_LABOUR} value={labour} onChange={handleLabourChange} className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer" />
                </div>
                <div id="price-control">
                    <label htmlFor="price-slider" className="flex justify-between font-bold"><span>Price per Pizza</span><span>€{price.toFixed(2)}</span></label>
                    <input id="price-slider" type="range" min="5" max="25" step="0.5" value={price} onChange={handlePriceChange} className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer" />
                </div>
            </div>
        </div>

        {/* Charts Section & Goal */}
        <div id="charts" className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="flex flex-col">
                <Chart title="Production Analysis" datasets={productionChartData} />
                <p className="text-xs text-center text-slate-500 dark:text-slate-400 px-4 pt-2">
                    Notice how 'Marginal Product' eventually declines. This is the <strong>law of diminishing returns</strong>, caused by the fixed size of your pizza oven (capital).
                </p>
            </div>
            <div className="flex flex-col gap-4">
              <Chart title="Cost Analysis" datasets={costChartData}>
                  <button onClick={handleAnalyzeCosts} disabled={analysis.isLoading} className="text-xs bg-slate-200 dark:bg-slate-700 font-semibold px-2 py-1 rounded-md hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed">
                      {analysis.isLoading ? '...' : 'Analyze Costs'}
                  </button>
              </Chart>
              { (analysis.isLoading || analysis.text) && (
                  <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-inner text-sm text-slate-600 dark:text-slate-300 -mt-4">
                      {analysis.isLoading ? 'Generating analysis...' : analysis.text.split('\n').map((p, i) => <p key={i} className="mb-2">{p}</p>)}
                  </div>
              )}
            </div>
            <div className="flex flex-col gap-6">
              <Chart title="Profit Analysis" datasets={profitChartData} />
              <div id="optimization-goal" className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-lg text-center flex flex-col justify-center">
                  <p className="text-sm text-slate-500 dark:text-slate-400">Max Possible Profit</p>
                  <p className="text-lg font-bold text-green-500">€{maxProfitData.totalProfit.toFixed(2)} at {maxProfitData.labour} chefs</p>
                  <div className="flex gap-2 mt-2">
                      <button onClick={handleOptimizeProduction} className="flex-1 text-xs bg-blue-500 text-white font-semibold px-3 py-1.5 rounded-md hover:bg-blue-600 transition-colors">
                          Optimize for Cost
                      </button>
                      <button onClick={handleSaveScenario} className="flex-1 text-xs bg-orange-500 text-white font-semibold px-3 py-1.5 rounded-md hover:bg-orange-600 transition-colors">
                        Save Outcome
                      </button>
                  </div>
              </div>
            </div>
        </div>

        {/* Scenario Comparison Section */}
        {savedScenarios.length > 0 && (
          <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-lg">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">Scenario Comparison</h2>
              <button onClick={handleClearScenarios} className="text-xs bg-slate-200 dark:bg-slate-700 font-semibold px-3 py-1.5 rounded-md hover:bg-slate-300 dark:hover:bg-slate-600">
                Clear
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 dark:bg-slate-700/50">
                  <tr>
                    <th className="p-3">Capital</th>
                    <th className="p-3">Max Profit</th>
                    <th className="p-3">Optimal Labour</th>
                    <th className="p-3">Price</th>
                    <th className="p-3">Marginal Cost</th>
                    <th className="p-3">Avg. Total Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {savedScenarios.map(s => (
                    <tr key={s.name} className="border-b border-slate-200 dark:border-slate-700">
                      <td className="p-3 font-semibold">{s.icon} {s.name}</td>
                      <td className="p-3 text-green-500 font-bold">€{s.maxProfit.toFixed(2)}</td>
                      <td className="p-3">{s.optimalLabour} chefs</td>
                      <td className="p-3">€{s.priceAtSave.toFixed(2)}</td>
                      <td className="p-3">€{isFinite(s.mcAtMaxProfit) ? s.mcAtMaxProfit.toFixed(2) : 'N/A'}</td>
                      <td className="p-3">€{isFinite(s.atcAtMaxProfit) ? s.atcAtMaxProfit.toFixed(2) : 'N/A'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      <footer className="text-center p-4 text-sm text-slate-500 dark:text-slate-400">
        Copyright Patrick Condon, Dublin College Blackrock
      </footer>
    </div>
  );
};


const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);