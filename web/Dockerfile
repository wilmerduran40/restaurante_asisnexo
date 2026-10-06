FROM nginx:alpine

# Imagen autocontenida: nginx.conf + estáticos del sitio.
# Build context = raíz del repo (docker-compose: context: ., dockerfile: web/Dockerfile).
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY web/maintenance.html /usr/share/nginx/html/maintenance.html
COPY index.html /usr/share/nginx/html/index.html
COPY menu.html /usr/share/nginx/html/menu.html
COPY data /usr/share/nginx/html/data
COPY css /usr/share/nginx/html/css
COPY img /usr/share/nginx/html/img

EXPOSE 80