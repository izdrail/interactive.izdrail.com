FROM ollama/ollama

# Set up application
WORKDIR /var/www/
COPY . .


# Configure Supervisor
COPY ./docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Expose necessary ports
EXPOSE 11431 3001 

# Start Supervisor
ENTRYPOINT ["supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf", "-n"]
