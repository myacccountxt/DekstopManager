import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

export async function validatePdfDocument(dataUrl) {
  const base64 = String(dataUrl).split(',').slice(1).join(',');
  if (!base64) throw new Error('Data PDF tidak lengkap.');
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  try {
    const pdf = await loadingTask.promise;
    if (pdf.numPages < 1) throw new Error('PDF tidak memiliki halaman.');
    await pdf.destroy();
  } catch (error) {
    await loadingTask.destroy();
    throw error;
  }
}

function PdfPage({ pdf, pageNumber, scale, scrollRoot, registerPage, onRenderError }) {
  const wrapperRef = useRef(null);
  const canvasRef = useRef(null);
  const [pageSize, setPageSize] = useState(null);
  const [isNearViewport, setIsNearViewport] = useState(false);

  useEffect(() => {
    let isActive = true;
    pdf.getPage(pageNumber).then((page) => {
      if (!isActive) return;
      const viewport = page.getViewport({ scale: 1 });
      setPageSize({ width: viewport.width, height: viewport.height });
    }).catch(() => {
      if (isActive) onRenderError();
    });

    return () => {
      isActive = false;
    };
  }, [pdf, pageNumber, onRenderError]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return undefined;
    registerPage(pageNumber, wrapper);

    if (!('IntersectionObserver' in window)) {
      setIsNearViewport(true);
      return () => registerPage(pageNumber, null);
    }

    const observer = new IntersectionObserver(
      ([entry]) => setIsNearViewport(entry.isIntersecting),
      { root: scrollRoot.current, rootMargin: '900px 0px' },
    );
    observer.observe(wrapper);
    return () => {
      observer.disconnect();
      registerPage(pageNumber, null);
    };
  }, [pageNumber, registerPage, scrollRoot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pageSize || !isNearViewport) return undefined;
    let isActive = true;
    let renderTask;

    pdf.getPage(pageNumber).then((page) => {
      if (!isActive) return;
      const viewport = page.getViewport({ scale });
      const context = canvas.getContext('2d');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      renderTask = page.render({ canvasContext: context, viewport });
      return renderTask.promise;
    }).catch((error) => {
      if (isActive && error.name !== 'RenderingCancelledException') onRenderError();
    });

    return () => {
      isActive = false;
      renderTask?.cancel();
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [pdf, pageNumber, scale, pageSize, isNearViewport, onRenderError]);

  return (
    <div
      ref={wrapperRef}
      className="pdf-page-shell"
      style={pageSize ? { width: pageSize.width * scale, height: pageSize.height * scale } : undefined}
      aria-label={`Halaman ${pageNumber}`}
    >
      <canvas ref={canvasRef} className="pdf-page-canvas" />
    </div>
  );
}

export default function PdfPreview({ fileName, data, onClose, onInvalid }) {
  const contentRef = useRef(null);
  const pageRefs = useRef([]);
  const scrollFrameRef = useRef(null);
  const onInvalidRef = useRef(onInvalid);
  const [pdf, setPdf] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState('');

  onInvalidRef.current = onInvalid;

  const registerPage = useCallback((pageNumber, element) => {
    pageRefs.current[pageNumber - 1] = element;
  }, []);

  const reportRenderError = useCallback(() => {
    setError('Halaman PDF tidak dapat dirender. Dokumen mungkin rusak.');
    onInvalidRef.current?.();
  }, []);

  const scrollToPage = (nextPage) => {
    const target = pageRefs.current[nextPage - 1];
    const content = contentRef.current;
    if (!target || !content) return;
    content.scrollTo({
      top: content.scrollTop + target.getBoundingClientRect().top - content.getBoundingClientRect().top - 18,
      behavior: 'smooth',
    });
    setPageNumber(nextPage);
  };

  const handleContentScroll = () => {
    if (scrollFrameRef.current) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const content = contentRef.current;
      if (!content) return;
      const contentBounds = content.getBoundingClientRect();
      const visiblePages = pageRefs.current
        .map((element, index) => ({ element, pageNumber: index + 1 }))
        .filter(({ element }) => element && element.getBoundingClientRect().bottom > contentBounds.top
          && element.getBoundingClientRect().top < contentBounds.bottom);
      if (!visiblePages.length) return;
      const center = contentBounds.top + contentBounds.height / 2;
      const nearestPage = visiblePages.reduce((nearest, current) => {
        const bounds = current.element.getBoundingClientRect();
        const distance = Math.abs((bounds.top + bounds.bottom) / 2 - center);
        return distance < nearest.distance ? { pageNumber: current.pageNumber, distance } : nearest;
      }, { pageNumber: pageNumber, distance: Number.POSITIVE_INFINITY });
      setPageNumber(nearestPage.pageNumber);
    });
  };

  useEffect(() => {
    let isActive = true;
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(data) });

    setPdf(null);
    setPageNumber(1);
    setPageCount(0);
    setError('');

    loadingTask.promise.then((loadedPdf) => {
      if (!isActive) return;
      setPdf(loadedPdf);
      setPageCount(loadedPdf.numPages);
    }).catch(() => {
      if (isActive) {
        setError('File ditemukan, tetapi isinya bukan PDF yang valid atau dokumen rusak. Catatan dokumen tetap tersimpan.');
        onInvalidRef.current?.();
      }
    });

    return () => {
      isActive = false;
      loadingTask.destroy();
    };
  }, [data]);

  useEffect(() => () => {
    if (scrollFrameRef.current) window.cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  return (
    <div className="pdf-preview-backdrop" onClick={onClose}>
      <section className="pdf-preview-window" role="dialog" aria-modal="true" aria-label={`Pratinjau ${fileName}`} onClick={(event) => event.stopPropagation()}>
        <header className="pdf-preview-toolbar">
          <div className="pdf-preview-file" title={fileName}>{fileName}</div>
          <div className="pdf-preview-controls">
            <button type="button" className="pdf-control-button" title="Perkecil" aria-label="Perkecil tampilan" disabled={scale <= 0.6} onClick={() => setScale((value) => Math.max(0.6, Number((value - 0.2).toFixed(1))))}>
              <ZoomOut size={17} aria-hidden="true" />
            </button>
            <span className="pdf-zoom-value">{Math.round(scale * 100)}%</span>
            <button type="button" className="pdf-control-button" title="Perbesar" aria-label="Perbesar tampilan" disabled={scale >= 2} onClick={() => setScale((value) => Math.min(2, Number((value + 0.2).toFixed(1))))}>
              <ZoomIn size={17} aria-hidden="true" />
            </button>
            <span className="pdf-control-divider" />
            <button type="button" className="pdf-control-button" title="Halaman sebelumnya" aria-label="Halaman sebelumnya" disabled={pageNumber <= 1 || !pageCount} onClick={() => scrollToPage(pageNumber - 1)}>
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <span className="pdf-page-count">{pageCount ? `${pageNumber} / ${pageCount}` : '-- / --'}</span>
            <button type="button" className="pdf-control-button" title="Halaman berikutnya" aria-label="Halaman berikutnya" disabled={!pageCount || pageNumber >= pageCount} onClick={() => scrollToPage(pageNumber + 1)}>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
          <button type="button" className="pdf-close-button" title="Tutup pratinjau" aria-label="Tutup pratinjau" onClick={onClose}>
            <X size={19} aria-hidden="true" />
          </button>
        </header>

        <div ref={contentRef} className="pdf-preview-content" onScroll={handleContentScroll}>
          {error ? <p className="pdf-preview-error" role="alert">{error}</p> : null}
          {!error && !pdf ? <p className="pdf-preview-loading">Memeriksa dan memuat PDF...</p> : null}
          {!error && pdf ? Array.from({ length: pageCount }, (_, index) => (
            <PdfPage
              key={`${data.length}-${index + 1}`}
              pdf={pdf}
              pageNumber={index + 1}
              scale={scale}
              scrollRoot={contentRef}
              registerPage={registerPage}
              onRenderError={reportRenderError}
            />
          )) : null}
        </div>
      </section>
    </div>
  );
}