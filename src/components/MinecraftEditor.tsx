import { useState, useRef, useEffect } from 'react';
import { minecraftBlocks, blockCategories, type MinecraftBlock } from '@/data/minecraftBlocks';
import { blockTextureUrls } from '@/data/minecraftBlockTextures';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import Icon from '@/components/ui/icon';
import { toast } from 'sonner';
import { useMediaQuery } from '@/hooks/use-media-query';

const CANVAS_WIDTH = 64;
const CANVAS_HEIGHT = 48;
const CELL_SIZE = 16;

type Tool = 'brush' | 'eraser' | 'fill';

interface Cell {
  blockId: string;
}

export default function MinecraftEditor() {
  const [grid, setGrid] = useState<Cell[][]>(() =>
    Array(CANVAS_HEIGHT).fill(null).map(() =>
      Array(CANVAS_WIDTH).fill(null).map(() => ({ blockId: 'air' }))
    )
  );
  const [selectedBlock, setSelectedBlock] = useState<MinecraftBlock>(minecraftBlocks[7]);
  const [tool, setTool] = useState<Tool>('brush');
  const [isDrawing, setIsDrawing] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [activeTab, setActiveTab] = useState('editor');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const textureCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const isMobile = useMediaQuery('(max-width: 768px)');

  useEffect(() => {
    preloadTextures();
  }, []);

  useEffect(() => {
    drawCanvas();
  }, [grid, zoom, showGrid, panOffset]);

  useEffect(() => {
    if (isMobile) {
      setZoom(0.75);
    }
  }, [isMobile]);

  const preloadTextures = () => {
    Object.entries(blockTextureUrls).forEach(([blockId, url]) => {
      if (url && !textureCache.current.has(blockId)) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = url;
        img.onload = () => {
          textureCache.current.set(blockId, img);
          drawCanvas();
        };
      }
    });
  };

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const container = containerRef.current;
    if (!container) return;

    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(panOffset.x, panOffset.y);

    for (let y = 0; y < CANVAS_HEIGHT; y++) {
      for (let x = 0; x < CANVAS_WIDTH; x++) {
        const cell = grid[y][x];
        const block = minecraftBlocks.find(b => b.id === cell.blockId);
        
        if (block && block.color !== 'transparent') {
          const texture = textureCache.current.get(cell.blockId);
          if (texture && texture.complete) {
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(
              texture,
              x * CELL_SIZE * zoom,
              y * CELL_SIZE * zoom,
              CELL_SIZE * zoom,
              CELL_SIZE * zoom
            );
          } else {
            ctx.fillStyle = block.color;
            ctx.fillRect(
              x * CELL_SIZE * zoom,
              y * CELL_SIZE * zoom,
              CELL_SIZE * zoom,
              CELL_SIZE * zoom
            );
          }
        }
      }
    }

    if (showGrid) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= CANVAS_WIDTH; x++) {
        ctx.beginPath();
        ctx.moveTo(x * CELL_SIZE * zoom, 0);
        ctx.lineTo(x * CELL_SIZE * zoom, CANVAS_HEIGHT * CELL_SIZE * zoom);
        ctx.stroke();
      }
      for (let y = 0; y <= CANVAS_HEIGHT; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * CELL_SIZE * zoom);
        ctx.lineTo(CANVAS_WIDTH * CELL_SIZE * zoom, y * CELL_SIZE * zoom);
        ctx.stroke();
      }
    }
    
    ctx.restore();
  };

  const getCanvasCoordinates = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left - panOffset.x) / (CELL_SIZE * zoom));
    const y = Math.floor((clientY - rect.top - panOffset.y) / (CELL_SIZE * zoom));
    return { x, y };
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    let clientX: number, clientY: number;

    if ('touches' in e) {
      if (e.touches.length === 0) return;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const coords = getCanvasCoordinates(clientX, clientY);
    if (!coords) return;
    const { x, y } = coords;

    if (x < 0 || x >= CANVAS_WIDTH || y < 0 || y >= CANVAS_HEIGHT) return;

    if (tool === 'fill') {
      floodFill(x, y);
    } else {
      paintCell(x, y);
    }
  };

  const paintCell = (x: number, y: number) => {
    setGrid(prev => {
      const newGrid = prev.map(row => [...row]);
      if (tool === 'brush') {
        newGrid[y][x] = { blockId: selectedBlock.id };
      } else if (tool === 'eraser') {
        newGrid[y][x] = { blockId: 'air' };
      }
      return newGrid;
    });
  };

  const floodFill = (startX: number, startY: number) => {
    const targetBlockId = grid[startY][startX].blockId;
    const replacementBlockId = tool === 'eraser' ? 'air' : selectedBlock.id;

    if (targetBlockId === replacementBlockId) return;

    const newGrid = grid.map(row => [...row]);
    const stack: [number, number][] = [[startX, startY]];

    while (stack.length > 0) {
      const [x, y] = stack.pop()!;

      if (x < 0 || x >= CANVAS_WIDTH || y < 0 || y >= CANVAS_HEIGHT) continue;
      if (newGrid[y][x].blockId !== targetBlockId) continue;

      newGrid[y][x] = { blockId: replacementBlockId };

      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }

    setGrid(newGrid);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 1 || e.shiftKey || tool === 'pan') {
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
      e.preventDefault();
    } else {
      setIsDrawing(true);
      handleCanvasClick(e);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      setPanOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
      return;
    }
    if (!isDrawing || tool === 'fill') return;
    handleCanvasClick(e);
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
    setIsPanning(false);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    handleCanvasClick(e);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || tool === 'fill') return;
    handleCanvasClick(e);
  };

  const handleTouchEnd = () => {
    setIsDrawing(false);
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(prev => Math.max(0.25, Math.min(5, prev + delta)));
  };

  const clearCanvas = () => {
    setGrid(
      Array(CANVAS_HEIGHT).fill(null).map(() =>
        Array(CANVAS_WIDTH).fill(null).map(() => ({ blockId: 'air' }))
      )
    );
    toast.success('Холст очищен');
  };

  const exportToPNG = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `minecraft-build-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Изображение экспортировано');
    });
  };

  const templates = [
    { name: 'Дом', grid: generateHouseTemplate() },
    { name: 'Дерево', grid: generateTreeTemplate() },
    { name: 'Меч', grid: generateSwordTemplate() },
  ];

  const loadTemplate = (templateGrid: Cell[][]) => {
    setGrid(templateGrid);
    setActiveTab('editor');
    toast.success('Шаблон загружен');
  };

  const SidebarContent = () => (
    <>
      <div className="p-4 border-b border-border">
        <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
          ⛏️ Minecraft 2D
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Редактор конструкций</p>
      </div>

      <div className="p-3 border-b border-border space-y-2">
        <div className="flex gap-2">
          <Button
            variant={tool === 'brush' ? 'default' : 'outline'}
            size="sm"
            className="flex-1"
            onClick={() => { setTool('brush'); if (isMobile) setIsMobileMenuOpen(false); }}
          >
            <Icon name="Brush" size={16} />
          </Button>
          <Button
            variant={tool === 'eraser' ? 'default' : 'outline'}
            size="sm"
            className="flex-1"
            onClick={() => { setTool('eraser'); if (isMobile) setIsMobileMenuOpen(false); }}
          >
            <Icon name="Eraser" size={16} />
          </Button>
          <Button
            variant={tool === 'fill' ? 'default' : 'outline'}
            size="sm"
            className="flex-1"
            onClick={() => { setTool('fill'); if (isMobile) setIsMobileMenuOpen(false); }}
          >
            <Icon name="PaintBucket" size={16} />
          </Button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setZoom(Math.max(0.25, zoom - 0.25))}
            >
              <Icon name="ZoomOut" size={16} />
            </Button>
            <span className="text-sm flex-1 text-center">{Math.round(zoom * 100)}%</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setZoom(Math.min(5, zoom + 0.25))}
            >
              <Icon name="ZoomIn" size={16} />
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => { setPanOffset({ x: 0, y: 0 }); setZoom(1); }}
          >
            <Icon name="Home" size={16} />
            <span className="ml-2">Сбросить вид</span>
          </Button>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => setShowGrid(!showGrid)}
        >
          <Icon name="Grid3x3" size={16} />
          <span className="ml-2">{showGrid ? 'Скрыть' : 'Показать'} сетку</span>
        </Button>

        <Button variant="destructive" size="sm" className="w-full" onClick={clearCanvas}>
          <Icon name="Trash2" size={16} />
          <span className="ml-2">Очистить</span>
        </Button>
      </div>

      <ScrollArea className="flex-1 p-3">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground mb-2">Выбранный блок:</p>
          <div className="p-2 bg-background rounded border border-border flex items-center gap-2 mb-3">
            {blockTextureUrls[selectedBlock.id] && textureCache.current.get(selectedBlock.id) ? (
              <img
                src={blockTextureUrls[selectedBlock.id]}
                alt={selectedBlock.name}
                className="w-8 h-8 rounded border border-border pixel-canvas"
              />
            ) : (
              <div
                className="w-8 h-8 rounded border border-border"
                style={{ backgroundColor: selectedBlock.color }}
              />
            )}
            <span className="text-sm">{selectedBlock.name}</span>
          </div>

          <Tabs defaultValue={blockCategories[0]}>
            <TabsList className="w-full grid grid-cols-2 h-auto gap-1">
              {blockCategories.slice(0, 8).map(cat => (
                <TabsTrigger key={cat} value={cat} className="text-xs px-1 py-1">
                  {cat}
                </TabsTrigger>
              ))}
            </TabsList>

            {blockCategories.map(category => (
              <TabsContent key={category} value={category} className="mt-2">
                <div className="grid grid-cols-4 gap-1">
                  {minecraftBlocks
                    .filter(block => block.category === category)
                    .map(block => {
                      const textureUrl = blockTextureUrls[block.id];
                      const hasTexture = textureUrl && textureCache.current.get(block.id);
                      
                      return (
                        <button
                          key={block.id}
                          onClick={() => { setSelectedBlock(block); if (isMobile) setIsMobileMenuOpen(false); }}
                          className={`w-full aspect-square rounded border-2 transition-all hover:scale-110 overflow-hidden ${
                            selectedBlock.id === block.id
                              ? 'border-primary ring-2 ring-primary'
                              : 'border-border'
                          }`}
                          style={!hasTexture ? { backgroundColor: block.color } : {}}
                          title={block.name}
                        >
                          {hasTexture && (
                            <img
                              src={textureUrl}
                              alt={block.name}
                              className="w-full h-full object-cover pixel-canvas"
                            />
                          )}
                        </button>
                      );
                    })}
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </ScrollArea>

      <div className="p-3 border-t border-border space-y-2">
        <Button className="w-full" onClick={exportToPNG}>
          <Icon name="Download" size={16} />
          <span className="ml-2">Экспорт PNG</span>
        </Button>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => { setActiveTab(activeTab === 'editor' ? 'gallery' : 'editor'); if (isMobile) setIsMobileMenuOpen(false); }}
        >
          <Icon name="Images" size={16} />
          <span className="ml-2">Галерея</span>
        </Button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {isMobile ? (
        <>
          <div className="sticky top-0 z-50 bg-card border-b border-border p-3 flex items-center justify-between">
            <h1 className="text-xl font-bold text-primary flex items-center gap-2">
              ⛏️ Minecraft 2D
            </h1>
            <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm">
                  <Icon name="Menu" size={20} />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-80 p-0">
                <div className="flex flex-col h-full">
                  <SidebarContent />
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </>
      ) : (
        <div className="w-64 border-r border-border bg-card flex flex-col">
          <SidebarContent />
        </div>
      )}


      <div className="flex-1 p-2 md:p-8 overflow-hidden">
        {activeTab === 'editor' ? (
          <div className="flex flex-col items-center justify-center h-full">
            <div 
              ref={containerRef}
              className="w-full h-full border border-border bg-muted rounded overflow-hidden relative"
              style={{ cursor: isPanning ? 'grabbing' : 'crosshair' }}
            >
              <canvas
                ref={canvasRef}
                className="pixel-canvas touch-none w-full h-full"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onWheel={handleWheel}
              />
            </div>
            <div className="mt-4 text-center text-sm text-muted-foreground">
              <p>Размер: {CANVAS_WIDTH}×{CANVAS_HEIGHT} блоков | Зум: {Math.round(zoom * 100)}% | 🖱️ Shift+ЛКМ или колёсико для навигации</p>
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-6">Галерея шаблонов</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {templates.map(template => (
                <Card
                  key={template.name}
                  className="p-4 cursor-pointer hover:border-primary transition-colors"
                  onClick={() => loadTemplate(template.grid)}
                >
                  <h3 className="font-semibold mb-2">{template.name}</h3>
                  <div className="aspect-square bg-muted rounded flex items-center justify-center">
                    <Icon name="Image" size={48} className="text-muted-foreground" />
                  </div>
                  <Button variant="outline" size="sm" className="w-full mt-3">
                    Загрузить
                  </Button>
                </Card>
              ))}
            </div>

            <Card className="p-6 mt-8">
              <h3 className="text-xl font-semibold mb-4">📖 Справка</h3>
              <div className="space-y-3 text-sm">
                <div>
                  <p className="font-medium">Инструменты:</p>
                  <ul className="list-disc list-inside text-muted-foreground ml-2 mt-1">
                    <li>Кисть - рисование блоков</li>
                    <li>Ластик - удаление блоков</li>
                    <li>Заливка - заполнение области</li>
                  </ul>
                </div>
                <div>
                  <p className="font-medium">Управление:</p>
                  <ul className="list-disc list-inside text-muted-foreground ml-2 mt-1">
                    <li>Клик - поставить/убрать блок</li>
                    <li>Зажать и тянуть - рисовать линию</li>
                    <li>Колёсико мыши - изменить зум</li>
                  </ul>
                </div>
                <div>
                  <p className="font-medium">Экспорт:</p>
                  <p className="text-muted-foreground ml-2 mt-1">
                    Нажмите "Экспорт PNG" для сохранения конструкции в формате PNG с прозрачным фоном
                  </p>
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

function generateHouseTemplate(): Cell[][] {
  const template = Array(CANVAS_HEIGHT).fill(null).map(() =>
    Array(CANVAS_WIDTH).fill(null).map(() => ({ blockId: 'air' }))
  );
  
  for (let y = 25; y < 35; y++) {
    for (let x = 20; x < 40; x++) {
      if (y === 25 || y === 34 || x === 20 || x === 39) {
        template[y][x] = { blockId: 'oak_planks' };
      }
    }
  }
  
  for (let i = 0; i < 10; i++) {
    template[24 - i][25 + i] = { blockId: 'bricks' };
    template[24 - i][34 - i] = { blockId: 'bricks' };
  }
  
  return template;
}

function generateTreeTemplate(): Cell[][] {
  const template = Array(CANVAS_HEIGHT).fill(null).map(() =>
    Array(CANVAS_WIDTH).fill(null).map(() => ({ blockId: 'air' }))
  );
  
  for (let y = 30; y < 40; y++) {
    template[y][32] = { blockId: 'oak_log' };
  }
  
  for (let y = 22; y < 30; y++) {
    for (let x = 28; x < 37; x++) {
      if (Math.random() > 0.3) {
        template[y][x] = { blockId: 'oak_log' };
      }
    }
  }
  
  return template;
}

function generateSwordTemplate(): Cell[][] {
  const template = Array(CANVAS_HEIGHT).fill(null).map(() =>
    Array(CANVAS_WIDTH).fill(null).map(() => ({ blockId: 'air' }))
  );
  
  for (let i = 0; i < 20; i++) {
    template[15 + i][32] = { blockId: 'iron_block' };
  }
  
  template[35][31] = { blockId: 'brown_wool' };
  template[35][32] = { blockId: 'brown_wool' };
  template[35][33] = { blockId: 'brown_wool' };
  template[36][32] = { blockId: 'brown_wool' };
  
  return template;
}