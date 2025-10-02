FROM nginx:alpine

# Copy the website files to the default nginx public directory
COPY . /usr/share/nginx/html/

# Remove the default nginx configuration
RUN rm /etc/nginx/conf.d/default.conf

# Copy a custom nginx configuration
COPY nginx.conf /etc/nginx/conf.d/

# Expose port 80
EXPOSE 80

# Start nginx with daemon off
CMD ["nginx", "-g", "daemon off;"]
